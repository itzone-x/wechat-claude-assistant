import { spawnSync } from 'node:child_process';
import { createDecipheriv, randomUUID } from 'node:crypto';
import { accessSync, constants } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { Readability } from '@mozilla/readability';
import { JSDOM, VirtualConsole } from 'jsdom';

import { DEFAULT_CDN_BASE_URL, getStatePaths } from './config.js';
import {
  assertSafeRemoteUrl,
  buildBypassProxyEnv,
  buildWebFetchInit,
  fetchRemoteBufferWithFallback,
  prefersProxyBypass,
  WEB_FETCH_TIMEOUT_MS,
  WEB_FETCH_USER_AGENT
} from './web-fetch.js';
import type { WorkerAttachment } from '../types/ilink.js';
import type { FetchLike, FetchResponseLike } from './web-fetch.js';

const IMAGE_EXTENSION_RE = /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif)(?:$|[?#])/i;
const AUDIO_EXTENSION_RE = /\.(wav|mp3|ogg|m4a|aac|flac|silk)(?:$|[?#])/i;
const DOCUMENT_EXTENSION_RE = /\.(pdf|docx?|xlsx?|pptx?|csv|tsv|md|markdown|txt|rtf|json|ya?ml|xml|html?)(?:$|[?#])/i;
const TEXT_EXTENSION_RE = /\.(md|markdown|txt|csv|tsv|json|ya?ml|xml|html?|rtf|log|ini|toml|conf|properties|sql)(?:$|[?#])/i;
const MAX_URL_CONTENT_ATTACHMENTS = 3;
const MAX_WEBPAGE_FOLLOW_PAGES = 3;
const BROWSER_IDLE_TIMEOUT_MS = 3_000;
const COMMON_CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
];

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}


export interface ResolveMessageAttachmentsOptions {
  text: string;
  itemList?: unknown[];
  targetDir?: string;
  baseUrl?: string;
  cdnBaseUrl?: string;
  fetchImpl?: FetchLike;
}

export interface DownloadRemoteImageOptions {
  targetDir?: string;
  fileName?: string;
  source?: WorkerAttachment['source'];
  originalUrl?: string;
  fetchImpl?: FetchLike;
}

export interface BrowserRenderResult {
  html: string;
  finalUrl?: string;
}

export type BrowserRenderLike = (url: string) => Promise<BrowserRenderResult | null>;

export interface DownloadUrlContentOptions extends DownloadRemoteImageOptions {
  browserRender?: BrowserRenderLike;
}

function defaultTargetDir(): string {
  return getStatePaths().attachmentsDir;
}

function isImageContentType(contentType: string | null | undefined): boolean {
  return Boolean(contentType && /^image\//i.test(contentType));
}

function looksLikeImageUrl(url: string): boolean {
  return IMAGE_EXTENSION_RE.test(url);
}

function looksLikeDocumentUrl(url: string): boolean {
  return DOCUMENT_EXTENSION_RE.test(url);
}

function looksLikeAbsoluteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function looksLikeRelativeMediaPath(value: string): boolean {
  return value.startsWith('/') || value.startsWith('?') || value.includes('=');
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function extractUrls(text: string): string[] {
  return unique(text.match(/https?:\/\/[^\s<>"')]+/gi) || []);
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function looksLikeMediaRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return [
    'image_url',
    'url',
    'download_url',
    'pic_url',
    'cdn_url',
    'file_url',
    'encrypt_query_param',
    'aeskey',
    'aes_key',
    'file_name',
    'mime_type',
    'content_type',
    'title'
  ].some((key) => key in record);
}

function findMediaRecord(value: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 4 || !value || typeof value !== 'object') {
    return null;
  }

  if (looksLikeMediaRecord(value)) {
    return value;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findMediaRecord(item, depth + 1);
      if (found) {
        return found;
      }
    }
    return null;
  }

  for (const child of Object.values(value as Record<string, unknown>)) {
    const found = findMediaRecord(child, depth + 1);
    if (found) {
      return found;
    }
  }

  return null;
}

function ensureValidDownloadResponse(response: FetchResponseLike, source: string): void {
  if (!response.ok) {
    throw new Error(`下载媒体失败: HTTP ${response.status} (${source})`);
  }
}

function resolveBrowserExecutable(): string | null {
  const explicit = process.env.WECHAT_AGENT_BROWSER_EXECUTABLE?.trim();
  if (explicit && isExecutable(explicit)) {
    return explicit;
  }

  for (const candidate of COMMON_CHROME_PATHS) {
    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  return null;
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function stripNoiseHtmlBlocks(html: string): string {
  let output = html;

  const noisyTags = ['script', 'style', 'noscript', 'svg', 'form', 'button', 'nav', 'footer', 'header', 'aside'];
  for (const tag of noisyTags) {
    output = output.replace(new RegExp(`<${tag}[\\s\\S]*?<\\/${tag}>`, 'gi'), ' ');
  }

  const noisySignals = [
    'toolbar',
    'comment',
    'comments',
    'related',
    'recommend',
    'sidebar',
    'share',
    'footer',
    'header',
    'nav',
    'qrcode',
    'advert',
    'copyright'
  ];

  for (const signal of noisySignals) {
    output = output.replace(
      new RegExp(
        `<([a-z0-9]+)\\b[^>]*(?:id|class)=["'][^"']*${signal}[^"']*["'][^>]*>[\\s\\S]*?<\\/\\1>`,
        'gi'
      ),
      ' '
    );
  }

  return output.replace(/<!--[\s\S]*?-->/g, ' ');
}

function stripReadabilityUnsafeTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
}

function htmlFragmentToText(html: string): string {
  return normalizeWhitespace(
    decodeHtmlEntities(
      stripNoiseHtmlBlocks(html)
        .replace(/<(br|\/p|\/div|\/section|\/article|\/li|\/ul|\/ol|\/h\d|\/tr|\/blockquote)>/gi, '\n')
        .replace(/<\/t[dh]>/gi, '\t')
        .replace(/<li\b[^>]*>/gi, '- ')
        .replace(/<tr\b[^>]*>/gi, '\n')
        .replace(/<p\b[^>]*>/gi, '\n')
        .replace(/<blockquote\b[^>]*>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
    )
  );
}

function extractPreferredHtmlRegion(html: string): string | null {
  const directBlocks = [
    /<article\b[^>]*>[\s\S]*?<\/article>/i,
    /<(div|section)\b[^>]+id=["']js_content["'][^>]*>[\s\S]*?<\/\1>/i,
    /<(div|section)\b[^>]+class=["'][^"']*(?:rich_media_content|entry-content|post-content|article-content|main-content)[^"']*["'][^>]*>[\s\S]*?<\/\1>/i
  ];

  let bestBlock: string | null = null;
  let bestLength = 0;

  for (const pattern of directBlocks) {
    const match = html.match(pattern);
    if (!match?.[0]) {
      continue;
    }
    const text = htmlFragmentToText(match[0]);
    if (text.length > bestLength) {
      bestBlock = match[0];
      bestLength = text.length;
    }
  }

  return bestBlock;
}

function normalizeWhitespace(input: string): string {
  return input
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractFirstMeaningfulHtmlValue(html: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match?.[1]) {
      continue;
    }

    const value = normalizeWhitespace(
      decodeHtmlEntities(match[1]).replace(/<[^>]+>/g, ' ')
    );
    if (value) {
      return value;
    }
  }

  return undefined;
}

function isMeaningfulTitle(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return false;
  }

  if (/^(loading|please wait|environment abnormal)$/i.test(normalized)) {
    return false;
  }

  return true;
}

function extractHtmlMetadataTitle(html: string): string | undefined {
  const preferred = [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']title["'][^>]+content=["']([^"']+)["']/i,
    /<h1[^>]*>([\s\S]*?)<\/h1>/i,
    /<title[^>]*>([\s\S]*?)<\/title>/i
  ];

  for (const pattern of preferred) {
    const value = extractFirstMeaningfulHtmlValue(html, [pattern]);
    if (isMeaningfulTitle(value)) {
      return value;
    }
  }

  return undefined;
}

function extractReadableHtml(html: string, url: string): { title?: string; text: string } | null {
  let dom: JSDOM | null = null;

  try {
    const sanitizedHtml = stripReadabilityUnsafeTags(html);
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', () => {});
    dom = new JSDOM(sanitizedHtml, {
      url,
      virtualConsole
    });
    const metadataTitle = extractHtmlMetadataTitle(html);
    const article = new Readability(dom.window.document, {
      charThreshold: 120,
      keepClasses: false
    }).parse();
    if (!article) {
      return null;
    }

    const articleTitle = typeof article.title === 'string' ? article.title : undefined;
    const title = isMeaningfulTitle(articleTitle)
      ? normalizeWhitespace(articleTitle || '')
      : metadataTitle;
    const text = normalizeWhitespace(
      [
        article.excerpt ? normalizeWhitespace(article.excerpt) : '',
        article.content ? htmlFragmentToText(article.content) : ''
      ].filter(Boolean).join('\n\n')
    );

    if (!text) {
      return null;
    }

    return { title, text };
  } catch {
    return null;
  } finally {
    dom?.window.close();
  }
}

function htmlToText(
  html: string,
  url: string
): { title?: string; text: string; mode: 'readability' | 'heuristic' } {
  const readable = extractReadableHtml(html, url);
  const title = readable?.title || extractHtmlMetadataTitle(html);
  const description = extractFirstMeaningfulHtmlValue(html, [
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i
  ]) || '';
  const preferredRegion = extractPreferredHtmlRegion(html);
  const bodyText = htmlFragmentToText(preferredRegion || html);
  const useReadable = Boolean(readable?.text && readable.text.length >= 300);
  const preferredText = useReadable ? readable!.text : bodyText;
  const text = normalizeWhitespace([description, preferredText].filter(Boolean).join('\n\n'));

  return {
    title,
    text,
    mode: useReadable ? 'readability' : 'heuristic'
  };
}

function xmlToText(xml: string): string {
  return normalizeWhitespace(
    decodeHtmlEntities(
      xml
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
    )
  );
}

function isHtmlContentType(contentType: string | null | undefined): boolean {
  return Boolean(contentType && /text\/html|application\/xhtml\+xml/i.test(contentType));
}

function isTextLikeContentType(contentType: string | null | undefined): boolean {
  return Boolean(
    contentType
    && /^(text\/|application\/(json|xml|yaml|x-yaml|javascript|csv|markdown))/i.test(contentType)
  );
}

function isDocumentContentType(contentType: string | null | undefined): boolean {
  return Boolean(
    contentType
    && /(application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument|application\/vnd\.ms-|application\/rtf)/i.test(contentType)
  );
}

function normalizeCharset(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized === 'gb2312' || normalized === 'gbk' || normalized === 'x-gbk') {
    return 'gbk';
  }
  if (normalized === 'gb18030') {
    return 'gb18030';
  }
  if (normalized === 'utf8') {
    return 'utf-8';
  }

  return normalized;
}

function extractCharsetFromContentType(contentType: string | null | undefined): string | null {
  if (!contentType) {
    return null;
  }

  const match = contentType.match(/charset=([^;]+)/i);
  return normalizeCharset(match?.[1] ?? null);
}

function extractCharsetFromHtmlBytes(buffer: Uint8Array): string | null {
  const probe = Buffer.from(buffer).toString('latin1');
  const metaCharset = probe.match(/<meta[^>]+charset=["']?\s*([a-z0-9_-]+)/i)?.[1];
  if (metaCharset) {
    return normalizeCharset(metaCharset);
  }

  const contentTypeCharset = probe.match(
    /<meta[^>]+http-equiv=["']content-type["'][^>]+content=["'][^"']*charset=([a-z0-9_-]+)/i
  )?.[1];
  return normalizeCharset(contentTypeCharset ?? null);
}

function decodeTextBuffer(
  buffer: Uint8Array,
  charsetCandidates: Array<string | null | undefined>
): string {
  const fallbacks = ['utf-8', 'gb18030', 'gbk'];
  const charsets = unique(
    [...charsetCandidates, ...fallbacks]
      .map((candidate) => normalizeCharset(candidate))
      .filter((candidate): candidate is string => Boolean(candidate))
  );

  for (const charset of charsets) {
    try {
      return new TextDecoder(charset).decode(buffer);
    } catch {
      continue;
    }
  }

  return Buffer.from(buffer).toString('utf8');
}

function guessImageExtension(input: {
  url?: string;
  fileName?: string;
  mimeType?: string | null;
}): string {
  const fromName = extname(input.fileName || '').toLowerCase();
  if (fromName) {
    return fromName;
  }

  const mimeType = input.mimeType?.toLowerCase() || '';
  if (mimeType === 'image/jpeg') {
    return '.jpg';
  }
  if (mimeType.startsWith('image/')) {
    return `.${mimeType.slice('image/'.length).replace('svg+xml', 'svg')}`;
  }

  if (input.url) {
    const match = IMAGE_EXTENSION_RE.exec(input.url);
    if (match?.[1]) {
      return `.${match[1].toLowerCase()}`;
    }
  }

  return '.img';
}

function guessAudioExtension(input: {
  fileName?: string;
  mimeType?: string | null;
}): string {
  const fromName = extname(input.fileName || '').toLowerCase();
  if (fromName) {
    return fromName;
  }

  const mimeType = input.mimeType?.toLowerCase() || '';
  if (mimeType === 'audio/wav') return '.wav';
  if (mimeType === 'audio/mpeg') return '.mp3';
  if (mimeType === 'audio/ogg') return '.ogg';
  if (mimeType === 'audio/mp4' || mimeType === 'audio/x-m4a') return '.m4a';
  if (mimeType === 'audio/aac') return '.aac';
  if (mimeType === 'audio/flac') return '.flac';
  if (mimeType === 'audio/silk') return '.silk';

  return '.audio';
}

function guessDocumentExtension(input: {
  url?: string;
  fileName?: string;
  mimeType?: string | null;
}): string {
  const fromName = extname(input.fileName || '').toLowerCase();
  if (fromName) {
    return fromName;
  }

  const mimeType = input.mimeType?.toLowerCase() || '';
  if (mimeType === 'application/pdf') return '.pdf';
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return '.docx';
  if (mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return '.pptx';
  if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return '.xlsx';
  if (mimeType === 'application/msword') return '.doc';
  if (mimeType === 'text/markdown') return '.md';
  if (mimeType === 'text/plain') return '.txt';

  if (input.url) {
    const match = DOCUMENT_EXTENSION_RE.exec(input.url);
    if (match?.[1]) {
      return `.${match[1].toLowerCase()}`;
    }
  }

  return '.bin';
}

function sniffImageMimeType(buffer: Uint8Array): string | undefined {
  if (buffer.length >= 8) {
    const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (pngSignature.every((byte, index) => buffer[index] === byte)) {
      return 'image/png';
    }
  }

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  if (
    buffer.length >= 12
    && buffer[0] === 0x52
    && buffer[1] === 0x49
    && buffer[2] === 0x46
    && buffer[3] === 0x46
    && buffer[8] === 0x57
    && buffer[9] === 0x45
    && buffer[10] === 0x42
    && buffer[11] === 0x50
  ) {
    return 'image/webp';
  }

  if (
    buffer.length >= 6
    && buffer[0] === 0x47
    && buffer[1] === 0x49
    && buffer[2] === 0x46
    && buffer[3] === 0x38
    && (buffer[4] === 0x37 || buffer[4] === 0x39)
    && buffer[5] === 0x61
  ) {
    return 'image/gif';
  }

  if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return 'image/bmp';
  }

  if (
    buffer.length >= 12
    && buffer[4] === 0x66
    && buffer[5] === 0x74
    && buffer[6] === 0x79
    && buffer[7] === 0x70
  ) {
    const brand = Buffer.from(buffer.slice(8, 12)).toString('ascii').toLowerCase();
    if (brand === 'heic' || brand === 'heix' || brand === 'hevc' || brand === 'hevx' || brand === 'mif1') {
      return 'image/heic';
    }
    if (brand === 'msf1') {
      return 'image/heif';
    }
  }

  return undefined;
}

function pcmBytesToWav(pcm: Uint8Array, sampleRate: number): Buffer {
  const pcmBytes = pcm.byteLength;
  const totalSize = 44 + pcmBytes;
  const buf = Buffer.allocUnsafe(totalSize);
  let offset = 0;

  buf.write('RIFF', offset);
  offset += 4;
  buf.writeUInt32LE(totalSize - 8, offset);
  offset += 4;
  buf.write('WAVE', offset);
  offset += 4;

  buf.write('fmt ', offset);
  offset += 4;
  buf.writeUInt32LE(16, offset);
  offset += 4;
  buf.writeUInt16LE(1, offset);
  offset += 2;
  buf.writeUInt16LE(1, offset);
  offset += 2;
  buf.writeUInt32LE(sampleRate, offset);
  offset += 4;
  buf.writeUInt32LE(sampleRate * 2, offset);
  offset += 4;
  buf.writeUInt16LE(2, offset);
  offset += 2;
  buf.writeUInt16LE(16, offset);
  offset += 2;

  buf.write('data', offset);
  offset += 4;
  buf.writeUInt32LE(pcmBytes, offset);
  offset += 4;

  Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).copy(buf, offset);
  return buf;
}

async function silkToWav(silkBuf: Buffer): Promise<Buffer | null> {
  try {
    const { decode } = await import('silk-wasm');
    const result = await decode(silkBuf, 24_000);
    return pcmBytesToWav(result.data, 24_000);
  } catch {
    return null;
  }
}

function sanitizeBaseName(value?: string): string {
  const base = basename(value || 'attachment', extname(value || ''));
  const sanitized = base.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitized || 'attachment';
}

async function writeImageBuffer(input: {
  buffer: Uint8Array;
  targetDir?: string;
  mimeType?: string | null;
  fileName?: string;
  source: WorkerAttachment['source'];
  originalUrl?: string;
}): Promise<WorkerAttachment> {
  const targetDir = input.targetDir || defaultTargetDir();
  await mkdir(targetDir, { recursive: true });

  const detectedMimeType = input.mimeType || sniffImageMimeType(input.buffer);

  const extension = guessImageExtension({
    url: input.originalUrl,
    fileName: input.fileName,
    mimeType: detectedMimeType
  });
  const filePath = join(
    targetDir,
    `${sanitizeBaseName(input.fileName)}-${randomUUID()}${extension}`
  );

  await writeFile(filePath, input.buffer);
  return {
    type: 'image',
    source: input.source,
    filePath,
    mimeType: detectedMimeType || undefined,
    fileName: input.fileName,
    originalUrl: input.originalUrl
  };
}

async function writeAudioBuffer(input: {
  buffer: Uint8Array;
  targetDir?: string;
  mimeType?: string | null;
  fileName?: string;
  source: WorkerAttachment['source'];
  originalUrl?: string;
}): Promise<WorkerAttachment> {
  const targetDir = input.targetDir || defaultTargetDir();
  await mkdir(targetDir, { recursive: true });

  const extension = guessAudioExtension({
    fileName: input.fileName,
    mimeType: input.mimeType
  });
  const filePath = join(
    targetDir,
    `${sanitizeBaseName(input.fileName || 'voice')}-${randomUUID()}${extension}`
  );

  await writeFile(filePath, input.buffer);
  return {
    type: 'audio',
    source: input.source,
    filePath,
    mimeType: input.mimeType || undefined,
    fileName: input.fileName,
    originalUrl: input.originalUrl
  };
}

async function writeRawDocumentBuffer(input: {
  buffer: Uint8Array;
  targetDir?: string;
  mimeType?: string | null;
  fileName?: string;
  originalUrl?: string;
}): Promise<{ filePath: string; mimeType?: string }> {
  const targetDir = input.targetDir || defaultTargetDir();
  await mkdir(targetDir, { recursive: true });

  const extension = guessDocumentExtension({
    url: input.originalUrl,
    fileName: input.fileName,
    mimeType: input.mimeType
  });
  const filePath = join(
    targetDir,
    `${sanitizeBaseName(input.fileName || input.originalUrl || 'document')}-${randomUUID()}${extension}`
  );

  await writeFile(filePath, input.buffer);
  return { filePath, mimeType: input.mimeType || undefined };
}

async function writeTextAttachment(input: {
  text: string;
  targetDir?: string;
  type: 'document' | 'webpage';
  source: WorkerAttachment['source'];
  fileName?: string;
  title?: string;
  mimeType?: string | null;
  originalUrl?: string;
  originalFilePath?: string;
  extractionStatus?: string;
}): Promise<WorkerAttachment> {
  const targetDir = input.targetDir || defaultTargetDir();
  await mkdir(targetDir, { recursive: true });

  const previewTitle = input.type === 'webpage' ? '网页内容' : '文档内容预览';
  const previewBody = [
    `# ${previewTitle}`,
    input.title ? `标题：${input.title}` : '',
    input.fileName ? `原始文件名：${input.fileName}` : '',
    input.originalUrl ? `原始链接：${input.originalUrl}` : '',
    input.originalFilePath ? `原始附件路径：${input.originalFilePath}` : '',
    input.mimeType ? `MIME Type：${input.mimeType}` : '',
    input.extractionStatus ? `提取状态：${input.extractionStatus}` : '',
    '',
    '## 提取内容',
    '',
    input.text.trim() || '未能提取正文内容。'
  ].filter(Boolean).join('\n');

  const filePath = join(
    targetDir,
    `${sanitizeBaseName(input.title || input.fileName || input.originalUrl || previewTitle)}-${randomUUID()}.md`
  );

  await writeFile(filePath, `${previewBody}\n`, 'utf8');
  return {
    type: input.type,
    source: input.source,
    filePath,
    mimeType: input.mimeType || 'text/markdown',
    fileName: input.fileName,
    originalUrl: input.originalUrl,
    originalFilePath: input.originalFilePath,
    title: input.title
  };
}

function isLikelyMetadataLine(line: string, title?: string): boolean {
  const compact = line.replace(/\s+/g, '');
  const compactTitle = title ? title.replace(/\s+/g, '') : '';

  if (compactTitle) {
    if (compact === compactTitle) {
      return true;
    }

    if (compact.length <= 40 && compactTitle.includes(compact)) {
      return true;
    }
  }

  return /(?:3Q中文网|3Qdu|手机版|手机在线阅读版|全文阅读|最新章节|作者[:：]?|章节目录|加入书签|打开书架|由.+创作)/i.test(line);
}

function extractMeaningfulBodyText(text: string, title?: string): string {
  const lines = text
    .split(/\n+/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  const noisePatterns = [
    /^首页$/,
    /^目录$/,
    /^上一章$/,
    /^下一章$/,
    /^上一页$/,
    /^下一页$/,
    /^足迹$/,
    /^关灯$/,
    /^超大$/,
    /^大$/,
    /^中$/,
    /^小$/,
    /^介绍$/,
    /^进书架$/,
    /^加书签$/,
    /^加入书签$/,
    /^本章未完.*继续阅读$/,
    /^本章已完$/,
    /^3Qdu手机版/,
    /^(首页|我的书架|阅读历史)(\s+(首页|我的书架|阅读历史))+$/u,
    /^分类(\s+排行)?(\s+完本)?(\s+新书)?$/u,
    /^作品:《/,
    /^打开书架$/,
    /^设置背景$/,
    /^loading\.{0,3}$/iu,
    /^loading…$/iu,
    /^please wait\.{0,3}$/iu,
    /^加载中\.{0,3}$/u
  ];

  return lines
    .map((line) => ({
      raw: line,
      normalized: line.replace(/^[\-•]+\s*/u, '').trim()
    }))
    .filter(({ normalized }) => !noisePatterns.some((pattern) => pattern.test(normalized)))
    .filter(({ normalized }) => !isLikelyMetadataLine(normalized, title))
    .filter((line) => {
      const compact = line.normalized.replace(/\s+/g, '');
      if (compact.length < 2) {
        return false;
      }
      if (/^[-\d\s、.。]+$/.test(compact)) {
        return false;
      }
      return true;
    })
    .map((line) => line.normalized)
    .join('\n\n');
}

async function renderHtmlPageInBrowser(
  url: string,
  browserRender?: BrowserRenderLike
): Promise<BrowserRenderResult | null> {
  if (browserRender) {
    return await browserRender(url);
  }

  const executablePath = resolveBrowserExecutable();
  if (!executablePath) {
    return null;
  }

  try {
    const playwright = await import('playwright-core');
    const browser = await playwright.chromium.launch({
      executablePath,
      headless: true,
      env: prefersProxyBypass() ? buildBypassProxyEnv() : process.env
    });

    try {
      const context = await browser.newContext({
        userAgent: WEB_FETCH_USER_AGENT,
        locale: 'zh-CN'
      });
      const page = await context.newPage();
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
      });
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: WEB_FETCH_TIMEOUT_MS
      });
      await page.waitForLoadState('networkidle', {
        timeout: BROWSER_IDLE_TIMEOUT_MS
      }).catch(() => {});

      return {
        html: await page.content(),
        finalUrl: page.url()
      };
    } finally {
      await browser.close();
    }
  } catch {
    return null;
  }
}

function hasMissingBodySignals(text: string): boolean {
  return /本章未完.*继续阅读|本章已完|正文未能成功提取|未能从源站公开 HTML 中提取到正文内容/s.test(text);
}

function shouldSkipBrowserFallback(url: string, html: string, parsedText: string): boolean {
  let hostname = '';
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }

  if (!hostname.endsWith('3qdu.org')) {
    return false;
  }

  const normalized = normalizeWhitespace(parsedText);
  if (!normalized) {
    return true;
  }

  return /本章未完.*继续阅读|本章已完|章节目录|加入书签|打开书架/u.test(normalized)
    || /id=["']novelcontent["']/i.test(html)
      && /本章未完.*继续阅读|本章已完/u.test(html);
}

function buildMissingBodyWarning(): string {
  return '正文缺失或源站未公开正文';
}

function buildMissingBodyExplanation(): string {
  return [
    '未能从源站公开 HTML 中提取到正文内容。',
    '当前抓取结果主要是标题、导航或分页提示，可能是源站未在 HTML 中公开正文，或正文需要脚本环境、登录态或额外校验后才可见。',
    '请不要根据标题、目录或站点框架推断正文细节。'
  ].join('\n');
}

function extractNextPageUrl(html: string, currentUrl: string): string | null {
  const nextHref = html.match(
    /<a\b[^>]+class=["'][^"']*\bp4\b[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>\s*[^<]*下一页/i
  )?.[1]
    || html.match(/var\s+next_page\s*=\s*["']([^"']+)["']/i)?.[1];

  if (!nextHref) {
    return null;
  }

  try {
    const resolved = new URL(nextHref, currentUrl).toString();
    return resolved === currentUrl ? null : resolved;
  } catch {
    return null;
  }
}

async function fetchHtmlPage(
  url: string,
  fetchImpl: FetchLike
): Promise<{ html: string; contentType: string | null }> {
  const remote = await fetchRemoteBufferWithFallback(url, fetchImpl);
  const contentType = remote.contentType;
  const buffer = remote.buffer;

  const html = decodeTextBuffer(buffer, [
    extractCharsetFromContentType(contentType),
    extractCharsetFromHtmlBytes(buffer)
  ]);
  return { html, contentType };
}

function decodeWechatAesKey(value: string): Buffer {
  const key = value.trim();
  if (/^[0-9a-f]{32}$/i.test(key)) {
    return Buffer.from(key, 'hex');
  }
  const decoded = Buffer.from(key, 'base64');
  if (decoded.length === 16) {
    return decoded;
  }
  if (decoded.length === 32 && /^[0-9a-f]{32}$/i.test(decoded.toString('ascii'))) {
    return Buffer.from(decoded.toString('ascii'), 'hex');
  }
  return decoded;
}

function decryptWechatMediaBuffer(buffer: Uint8Array, aesKey: string): Buffer {
  const key = decodeWechatAesKey(aesKey);
  const decipher = createDecipheriv('aes-128-ecb', key, null);
  decipher.setAutoPadding(true);
  return Buffer.concat([decipher.update(Buffer.from(buffer)), decipher.final()]);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function buildWechatMediaUrl(baseUrl: string, encryptQueryParam: string): string {
  const bare = encryptQueryParam.trim().replace(/^\?/, '');
  return `${trimTrailingSlash(baseUrl)}/download?encrypted_query_param=${encodeURIComponent(bare)}`;
}

function buildWechatMediaUrlCandidates(baseUrl: string, encryptQueryParam: string): string[] {
  const normalizedBase = trimTrailingSlash(baseUrl);
  const bare = encryptQueryParam.trim().replace(/^\?/, '');
  const direct = buildWechatMediaUrl(baseUrl, encryptQueryParam);

  return unique([
    direct,
    `${normalizedBase}/download?encrypt_query_param=${encodeURIComponent(bare)}`,
    `${normalizedBase}/download?encrypted_query_param=${encodeURIComponent(bare)}`,
    `${normalizedBase}?encrypted_query_param=${encodeURIComponent(bare)}`
  ]);
}

function runCapture(command: string, args: string[], input?: Buffer): string | null {
  const result = spawnSync(command, args, {
    input,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  });

  if (result.error || result.status !== 0) {
    return null;
  }

  return String(result.stdout || '').trim();
}

function extractOoxmlText(filePath: string, patterns: RegExp[]): string | null {
  const entryList = runCapture('unzip', ['-Z1', filePath]);
  if (!entryList) {
    return null;
  }

  const entries = entryList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && patterns.some((pattern) => pattern.test(line)));

  if (entries.length === 0) {
    return null;
  }

  const texts = entries.map((entry) => {
    const xml = runCapture('unzip', ['-p', filePath, entry]);
    return xml ? xmlToText(xml) : '';
  }).filter(Boolean);

  return texts.length > 0 ? normalizeWhitespace(texts.join('\n\n')) : null;
}

function extractDocumentTextFromFile(filePath: string, mimeType?: string | null): string | null {
  const extension = extname(filePath).toLowerCase();

  if (TEXT_EXTENSION_RE.test(extension)) {
    const text = runCapture('cat', [filePath]);
    return text ? normalizeWhitespace(text) : null;
  }

  if (extension === '.doc' || extension === '.docx' || mimeType === 'application/msword') {
    const textutil = runCapture('textutil', ['-convert', 'txt', '-stdout', filePath]);
    if (textutil) {
      return normalizeWhitespace(textutil);
    }
  }

  if (extension === '.pdf' || mimeType === 'application/pdf') {
    const pdftotext = runCapture('pdftotext', ['-layout', filePath, '-']);
    if (pdftotext) {
      return normalizeWhitespace(pdftotext);
    }
    const strings = runCapture('strings', ['-n', '6', filePath]);
    if (strings) {
      return normalizeWhitespace(strings);
    }
    return null;
  }

  if (extension === '.docx') {
    return extractOoxmlText(filePath, [
      /^word\/document\.xml$/,
      /^word\/header\d+\.xml$/,
      /^word\/footer\d+\.xml$/
    ]);
  }

  if (extension === '.pptx') {
    return extractOoxmlText(filePath, [/^ppt\/slides\/slide\d+\.xml$/]);
  }

  if (extension === '.xlsx') {
    return extractOoxmlText(filePath, [
      /^xl\/sharedStrings\.xml$/,
      /^xl\/worksheets\/sheet\d+\.xml$/
    ]);
  }

  return null;
}

function extractWechatImageCandidate(item: unknown): {
  directUrl?: string;
  encryptQueryParam?: string;
  aesKey?: string;
  fileName?: string;
} | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return null;
  }

  const record = item as Record<string, unknown>;
  if (!record.image_item && (record.file_item || record.document_item)) {
    return null;
  }
  const searchRoot = { ...record };
  delete searchRoot.voice_item;
  delete searchRoot.file_item;
  delete searchRoot.document_item;
  const nestedImageContainer = findMediaRecord(searchRoot);
  const imageContainer = typeof record.image_item === 'object' && record.image_item
    ? record.image_item as Record<string, unknown>
    : nestedImageContainer
      ? nestedImageContainer as Record<string, unknown>
    : looksLikeMediaRecord(record)
      ? record
      : null;
  if (!imageContainer) {
    return null;
  }

  const imageItem = imageContainer;
  const media = typeof imageItem.media === 'object' && imageItem.media
    ? imageItem.media as Record<string, any>
    : {};
  const directUrlCandidate = firstString(
    imageItem.image_url,
    imageItem.url,
    imageItem.download_url,
    imageItem.pic_url,
    imageItem.cdn_url,
    media.image_url,
    media.url,
    media.download_url,
    media.pic_url,
    media.cdn_url
  );
  const normalizedDirectUrl = directUrlCandidate && (
    looksLikeAbsoluteUrl(directUrlCandidate) || looksLikeRelativeMediaPath(directUrlCandidate)
  )
    ? directUrlCandidate
    : undefined;
  const normalizedEncryptQueryParam = firstString(
    imageItem.encrypt_query_param,
    media.encrypt_query_param,
    directUrlCandidate && !normalizedDirectUrl ? directUrlCandidate : undefined
  );

  return {
    directUrl: normalizedDirectUrl,
    encryptQueryParam: normalizedEncryptQueryParam,
    aesKey: firstString(
      imageItem.aeskey,
      imageItem.aes_key,
      media.aeskey,
      media.aes_key
    ),
    fileName: firstString(
      imageItem.file_name,
      media.file_name
    )
  };
}

function extractWechatVoiceCandidate(item: unknown): {
  encryptQueryParam?: string;
  aesKey?: string;
  fileName?: string;
} | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return null;
  }

  const record = item as Record<string, unknown>;
  const voiceItem = typeof record.voice_item === 'object' && record.voice_item
    ? record.voice_item as Record<string, unknown>
    : null;
  if (!voiceItem) {
    return null;
  }

  const media = typeof voiceItem.media === 'object' && voiceItem.media
    ? voiceItem.media as Record<string, unknown>
    : {};

  const encryptQueryParam = firstString(
    voiceItem.encrypt_query_param,
    media.encrypt_query_param
  );

  if (!encryptQueryParam) {
    return null;
  }

  return {
    encryptQueryParam,
    aesKey: firstString(
      voiceItem.aeskey,
      voiceItem.aes_key,
      media.aeskey,
      media.aes_key
    ),
    fileName: firstString(
      voiceItem.file_name,
      'voice'
    )
  };
}

function extractWechatFileCandidate(item: unknown): {
  directUrl?: string;
  encryptQueryParam?: string;
  aesKey?: string;
  fileName?: string;
  mimeType?: string;
} | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return null;
  }

  const record = item as Record<string, unknown>;
  const fileItem = typeof record.file_item === 'object' && record.file_item
    ? record.file_item as Record<string, unknown>
    : typeof record.document_item === 'object' && record.document_item
      ? record.document_item as Record<string, unknown>
      : null;
  const media = fileItem && typeof fileItem.media === 'object' && fileItem.media
    ? fileItem.media as Record<string, unknown>
    : {};

  if (!fileItem && !looksLikeMediaRecord(record)) {
    return null;
  }

  const candidateRoot = fileItem || record;
  const directUrlCandidate = firstString(
    candidateRoot.file_url,
    candidateRoot.url,
    candidateRoot.download_url,
    media.file_url,
    media.url,
    media.download_url,
    media.pic_url
  );
  const normalizedDirectUrl = directUrlCandidate && (
    looksLikeAbsoluteUrl(directUrlCandidate) || looksLikeRelativeMediaPath(directUrlCandidate)
  )
    ? directUrlCandidate
    : undefined;

  return {
    directUrl: normalizedDirectUrl,
    encryptQueryParam: firstString(
      candidateRoot.encrypt_query_param,
      media.encrypt_query_param,
      directUrlCandidate && !normalizedDirectUrl ? directUrlCandidate : undefined
    ),
    aesKey: firstString(
      candidateRoot.aeskey,
      candidateRoot.aes_key,
      media.aeskey,
      media.aes_key
    ),
    fileName: firstString(
      candidateRoot.file_name,
      candidateRoot.name,
      media.file_name
    ),
    mimeType: firstString(
      candidateRoot.mime_type,
      candidateRoot.content_type,
      media.mime_type,
      media.content_type
    )
  };
}

function summarizeMediaCandidate(
  candidate: {
    directUrl?: string;
    encryptQueryParam?: string;
    aesKey?: string;
    fileName?: string;
  },
  item: unknown
): string {
  const itemSummary = (() => {
    if (!item || typeof item !== 'object') {
      return 'non-object';
    }
    const record = item as Record<string, unknown>;
    const imageItem = typeof record.image_item === 'object' && record.image_item
      ? record.image_item as Record<string, unknown>
      : null;
    const voiceItem = typeof record.voice_item === 'object' && record.voice_item
      ? record.voice_item as Record<string, unknown>
      : null;
    const media = imageItem && typeof imageItem.media === 'object' && imageItem.media
      ? imageItem.media as Record<string, unknown>
      : voiceItem && typeof voiceItem.media === 'object' && voiceItem.media
        ? voiceItem.media as Record<string, unknown>
        : null;

    return JSON.stringify({
      itemKeys: Object.keys(record).slice(0, 10),
      imageItemKeys: imageItem ? Object.keys(imageItem).slice(0, 10) : [],
      voiceItemKeys: voiceItem ? Object.keys(voiceItem).slice(0, 10) : [],
      mediaKeys: media ? Object.keys(media).slice(0, 10) : [],
      type: record.type,
      file_name: typeof imageItem?.file_name === 'string'
        ? imageItem.file_name
        : typeof voiceItem?.file_name === 'string'
          ? voiceItem.file_name
          : undefined,
      voice_text: typeof voiceItem?.text === 'string' ? voiceItem.text.slice(0, 48) : undefined,
      url: typeof imageItem?.url === 'string' ? imageItem.url.slice(0, 48) : undefined,
      pic_url: typeof imageItem?.pic_url === 'string' ? imageItem.pic_url.slice(0, 48) : undefined,
      encrypt_query_param: typeof media?.encrypt_query_param === 'string'
        ? media.encrypt_query_param.slice(0, 48)
        : undefined,
      hasAesKey: Boolean(candidate.aesKey)
    });
  })();

  return JSON.stringify({
    directUrl: candidate.directUrl ? candidate.directUrl.slice(0, 96) : undefined,
    encryptQueryParam: candidate.encryptQueryParam
      ? candidate.encryptQueryParam.slice(0, 96)
      : undefined,
    fileName: candidate.fileName,
    hasAesKey: Boolean(candidate.aesKey),
    item: itemSummary
  });
}

export function extractImageUrls(text: string): string[] {
  return extractUrls(text).filter((value) => looksLikeImageUrl(value));
}

export function extractContentUrls(text: string): string[] {
  return extractUrls(text).filter((value) => !looksLikeImageUrl(value));
}

export async function downloadRemoteImage(
  url: string,
  options: DownloadRemoteImageOptions = {}
): Promise<WorkerAttachment> {
  if (looksLikeAbsoluteUrl(url) && options.source !== 'wechat-upload') {
    await assertSafeRemoteUrl(url);
  }

  const fetchImpl = options.fetchImpl || (globalThis.fetch as FetchLike | undefined);
  if (!fetchImpl) {
    throw new Error('当前环境不支持 fetch，无法下载图片。');
  }

  const response = await fetchImpl(url, buildWebFetchInit(url));
  ensureValidDownloadResponse(response, url);
  const mimeType = response.headers.get('content-type');
  const buffer = Buffer.from(await response.arrayBuffer());
  const sniffedMimeType = sniffImageMimeType(buffer);
  if (
    !isImageContentType(mimeType)
    && !sniffedMimeType
    && !looksLikeImageUrl(url)
    && !looksLikeImageUrl(options.fileName || '')
  ) {
    throw new Error(`远程资源不是图片: ${url}`);
  }

  return await writeImageBuffer({
    buffer,
    targetDir: options.targetDir,
    mimeType: mimeType || sniffedMimeType,
    fileName: options.fileName,
    source: options.source || 'image-link',
    originalUrl: options.originalUrl || url
  });
}

async function downloadWechatImage(
  candidate: {
    directUrl?: string;
    encryptQueryParam?: string;
    aesKey?: string;
    fileName?: string;
  },
  options: ResolveMessageAttachmentsOptions
): Promise<WorkerAttachment | null> {
  if (candidate.directUrl) {
    return await downloadRemoteImage(candidate.directUrl, {
      targetDir: options.targetDir,
      fileName: candidate.fileName,
      source: 'wechat-upload',
      originalUrl: candidate.directUrl,
      fetchImpl: options.fetchImpl
    });
  }

  if (!candidate.encryptQueryParam) {
    return null;
  }

  const fetchImpl = options.fetchImpl || (globalThis.fetch as FetchLike | undefined);
  if (!fetchImpl) {
    throw new Error('当前环境不支持 fetch，无法下载微信图片。');
  }

  const baseUrl = options.cdnBaseUrl?.trim()
    || process.env.WECHAT_AGENT_CDN_BASE_URL?.trim()
    || DEFAULT_CDN_BASE_URL
    || options.baseUrl?.trim();
  if (!baseUrl) {
    throw new Error('缺少微信媒体下载地址，请设置 WECHAT_AGENT_CDN_BASE_URL。');
  }

  const candidateUrls = buildWechatMediaUrlCandidates(baseUrl, candidate.encryptQueryParam);
  let lastError: Error | null = null;
  let response: FetchResponseLike | null = null;
  let downloadUrl = candidateUrls[0];

  for (const url of candidateUrls) {
    try {
      const currentResponse = await fetchImpl(url);
      ensureValidDownloadResponse(currentResponse, url);
      response = currentResponse;
      downloadUrl = url;
      break;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  if (!response) {
    console.error(`[media] 微信图片候选下载地址: ${candidateUrls.join(' | ')}`);
    throw lastError || new Error('下载微信图片失败');
  }

  let buffer: Uint8Array = Buffer.from(await response.arrayBuffer());
  if (candidate.aesKey) {
    buffer = decryptWechatMediaBuffer(buffer, candidate.aesKey);
  }

  return await writeImageBuffer({
    buffer,
    targetDir: options.targetDir,
    mimeType: response.headers.get('content-type'),
    fileName: candidate.fileName,
    source: 'wechat-upload',
    originalUrl: downloadUrl
  });
}

async function downloadWechatVoice(
  candidate: {
    encryptQueryParam?: string;
    aesKey?: string;
    fileName?: string;
  },
  options: ResolveMessageAttachmentsOptions
): Promise<WorkerAttachment | null> {
  if (!candidate.encryptQueryParam || !candidate.aesKey) {
    return null;
  }

  const fetchImpl = options.fetchImpl || (globalThis.fetch as FetchLike | undefined);
  if (!fetchImpl) {
    throw new Error('当前环境不支持 fetch，无法下载微信语音。');
  }

  const baseUrl = options.cdnBaseUrl?.trim()
    || process.env.WECHAT_AGENT_CDN_BASE_URL?.trim()
    || DEFAULT_CDN_BASE_URL
    || options.baseUrl?.trim();
  if (!baseUrl) {
    throw new Error('缺少微信媒体下载地址，请设置 WECHAT_AGENT_CDN_BASE_URL。');
  }

  const candidateUrls = buildWechatMediaUrlCandidates(baseUrl, candidate.encryptQueryParam);
  let lastError: Error | null = null;
  let response: FetchResponseLike | null = null;
  let downloadUrl = candidateUrls[0];

  for (const url of candidateUrls) {
    try {
      const currentResponse = await fetchImpl(url);
      ensureValidDownloadResponse(currentResponse, url);
      response = currentResponse;
      downloadUrl = url;
      break;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  if (!response) {
    console.error(`[media] 微信语音候选下载地址: ${candidateUrls.join(' | ')}`);
    throw lastError || new Error('下载微信语音失败');
  }

  const encrypted = Buffer.from(await response.arrayBuffer());
  const silkBuffer = decryptWechatMediaBuffer(encrypted, candidate.aesKey);
  const wavBuffer = await silkToWav(silkBuffer);

  if (wavBuffer) {
    return await writeAudioBuffer({
      buffer: wavBuffer,
      targetDir: options.targetDir,
      mimeType: 'audio/wav',
      fileName: candidate.fileName,
      source: 'wechat-upload',
      originalUrl: downloadUrl
    });
  }

  return await writeAudioBuffer({
    buffer: silkBuffer,
    targetDir: options.targetDir,
    mimeType: 'audio/silk',
    fileName: candidate.fileName,
    source: 'wechat-upload',
    originalUrl: downloadUrl
  });
}

async function downloadWechatDocument(
  candidate: {
    directUrl?: string;
    encryptQueryParam?: string;
    aesKey?: string;
    fileName?: string;
    mimeType?: string;
  },
  options: ResolveMessageAttachmentsOptions
): Promise<WorkerAttachment | null> {
  const fetchImpl = options.fetchImpl || (globalThis.fetch as FetchLike | undefined);
  if (!fetchImpl) {
    throw new Error('当前环境不支持 fetch，无法下载微信附件。');
  }

  let response: FetchResponseLike | null = null;
  let downloadUrl = candidate.directUrl;

  if (candidate.directUrl) {
    response = await fetchImpl(candidate.directUrl, buildWebFetchInit(candidate.directUrl));
    ensureValidDownloadResponse(response, candidate.directUrl);
  } else if (candidate.encryptQueryParam) {
    const baseUrl = options.cdnBaseUrl?.trim()
      || process.env.WECHAT_AGENT_CDN_BASE_URL?.trim()
      || DEFAULT_CDN_BASE_URL
      || options.baseUrl?.trim();
    if (!baseUrl) {
      throw new Error('缺少微信媒体下载地址，请设置 WECHAT_AGENT_CDN_BASE_URL。');
    }

    const candidateUrls = buildWechatMediaUrlCandidates(baseUrl, candidate.encryptQueryParam);
    let lastError: Error | null = null;

    for (const url of candidateUrls) {
      try {
        const currentResponse = await fetchImpl(url, buildWebFetchInit(url));
        ensureValidDownloadResponse(currentResponse, url);
        response = currentResponse;
        downloadUrl = url;
        break;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    if (!response) {
      throw lastError || new Error('下载微信附件失败');
    }
  } else {
    return null;
  }

  let buffer: Uint8Array = Buffer.from(await response.arrayBuffer());
  if (candidate.aesKey) {
    buffer = decryptWechatMediaBuffer(buffer, candidate.aesKey);
  }

  const rawFile = await writeRawDocumentBuffer({
    buffer,
    targetDir: options.targetDir,
    mimeType: candidate.mimeType || response.headers.get('content-type'),
    fileName: candidate.fileName,
    originalUrl: downloadUrl
  });
  const extractedText = extractDocumentTextFromFile(rawFile.filePath, rawFile.mimeType);

  return await writeTextAttachment({
    text: extractedText || '',
    targetDir: options.targetDir,
    type: 'document',
    source: 'wechat-upload',
    fileName: candidate.fileName,
    mimeType: rawFile.mimeType,
    originalUrl: downloadUrl,
    originalFilePath: rawFile.filePath
  });
}

export async function downloadUrlContent(
  url: string,
  options: DownloadUrlContentOptions = {}
): Promise<WorkerAttachment> {
  await assertSafeRemoteUrl(url);

  const fetchImpl = options.fetchImpl || (globalThis.fetch as FetchLike | undefined);
  if (!fetchImpl) {
    throw new Error('当前环境不支持 fetch，无法下载链接内容。');
  }

  let contentType: string | null = null;
  let buffer: Buffer | null = null;

  try {
    const response = await fetchImpl(url, buildWebFetchInit(url));
    ensureValidDownloadResponse(response, url);
    contentType = response.headers.get('content-type');
    buffer = Buffer.from(await response.arrayBuffer());
  } catch {
    const fallbackPage = await fetchHtmlPage(url, fetchImpl);
    contentType = fallbackPage.contentType || 'text/html';
    buffer = Buffer.from(fallbackPage.html, 'utf8');
  }

  if (!buffer) {
    throw new Error(`未能下载链接内容: ${url}`);
  }

  if (isHtmlContentType(contentType)) {
    let currentUrl = url;
    let html = decodeTextBuffer(buffer, [
      extractCharsetFromContentType(contentType),
      extractCharsetFromHtmlBytes(buffer)
    ]);
    let parsed = htmlToText(html, currentUrl);
    let title = parsed.title;
    const meaningfulSegments: string[] = [];
    const visited = new Set<string>([currentUrl]);

    const firstMeaningful = parsed.mode === 'readability'
      ? parsed.text
      : extractMeaningfulBodyText(parsed.text, title);
    if (firstMeaningful) {
      meaningfulSegments.push(firstMeaningful);
    }

    for (let pageIndex = 1; pageIndex < MAX_WEBPAGE_FOLLOW_PAGES; pageIndex += 1) {
      if (!hasMissingBodySignals(parsed.text)) {
        break;
      }

      const nextUrl = extractNextPageUrl(html, currentUrl);
      if (!nextUrl || visited.has(nextUrl)) {
        break;
      }

      visited.add(nextUrl);
      const nextPage = await fetchHtmlPage(nextUrl, fetchImpl);
      html = nextPage.html;
      currentUrl = nextUrl;
      parsed = htmlToText(html, currentUrl);
      title = title || parsed.title;

      const nextMeaningful = parsed.mode === 'readability'
        ? parsed.text
        : extractMeaningfulBodyText(parsed.text, title);
      if (nextMeaningful) {
        meaningfulSegments.push(nextMeaningful);
      }
    }

    const extractedText = meaningfulSegments.length > 0
      ? normalizeWhitespace(meaningfulSegments.join('\n\n'))
      : buildMissingBodyExplanation();

    if (meaningfulSegments.length === 0 && !shouldSkipBrowserFallback(url, html, parsed.text)) {
      const rendered = await renderHtmlPageInBrowser(url, options.browserRender);
      if (rendered?.html) {
        const renderedUrl = rendered.finalUrl || url;
        const renderedParsed = htmlToText(rendered.html, renderedUrl);
        const renderedMeaningful = renderedParsed.mode === 'readability'
          ? renderedParsed.text
          : extractMeaningfulBodyText(renderedParsed.text, renderedParsed.title || title);

        if (renderedMeaningful) {
          return await writeTextAttachment({
            text: normalizeWhitespace(renderedMeaningful),
            targetDir: options.targetDir,
            type: 'webpage',
            source: 'url-link',
            title: renderedParsed.title || title,
            mimeType: contentType,
            originalUrl: url
          });
        }
      }
    }

    return await writeTextAttachment({
      text: extractedText,
      targetDir: options.targetDir,
      type: 'webpage',
      source: 'url-link',
      title,
      mimeType: contentType,
      originalUrl: url,
      extractionStatus: meaningfulSegments.length > 0 ? undefined : buildMissingBodyWarning()
    });
  }

  if (isTextLikeContentType(contentType) || looksLikeDocumentUrl(url) && TEXT_EXTENSION_RE.test(url)) {
    const text = decodeTextBuffer(buffer, [extractCharsetFromContentType(contentType)]);
    return await writeTextAttachment({
      text: text,
      targetDir: options.targetDir,
      type: 'document',
      source: 'url-link',
      fileName: options.fileName,
      mimeType: contentType,
      originalUrl: url
    });
  }

  if (isDocumentContentType(contentType) || looksLikeDocumentUrl(url)) {
    const rawFile = await writeRawDocumentBuffer({
      buffer,
      targetDir: options.targetDir,
      mimeType: contentType,
      fileName: options.fileName,
      originalUrl: url
    });
    const extractedText = extractDocumentTextFromFile(rawFile.filePath, rawFile.mimeType);

    return await writeTextAttachment({
      text: extractedText || '',
      targetDir: options.targetDir,
      type: 'document',
      source: 'url-link',
      fileName: options.fileName,
      mimeType: rawFile.mimeType,
      originalUrl: url,
      originalFilePath: rawFile.filePath
    });
  }

  throw new Error(`暂不支持解析该链接内容: ${url}`);
}

export async function resolveMessageAttachments(
  options: ResolveMessageAttachmentsOptions
): Promise<WorkerAttachment[]> {
  const attachments: WorkerAttachment[] = [];
  const targetDir = options.targetDir || defaultTargetDir();

  for (const item of options.itemList || []) {
    try {
      const imageCandidate = extractWechatImageCandidate(item);
      const voiceCandidate = extractWechatVoiceCandidate(item);
      const fileCandidate = extractWechatFileCandidate(item);
      if (!imageCandidate && !voiceCandidate && !fileCandidate) {
        continue;
      }

      const attachment = imageCandidate
        ? await downloadWechatImage(imageCandidate, {
            ...options,
            targetDir
          })
        : voiceCandidate
          ? await downloadWechatVoice(voiceCandidate, {
              ...options,
              targetDir
            })
          : await downloadWechatDocument(fileCandidate!, {
              ...options,
              targetDir
            });
      if (attachment) {
        attachments.push(attachment);
      }
    } catch (error) {
      console.error(
        `[media] 处理微信附件失败: ${error instanceof Error ? error.message : String(error)}`
      );
      const candidate = extractWechatImageCandidate(item) || extractWechatVoiceCandidate(item) || extractWechatFileCandidate(item);
      if (candidate) {
        console.error(`[media] 微信附件候选字段: ${summarizeMediaCandidate(candidate, item)}`);
      }
    }
  }

  for (const url of extractImageUrls(options.text)) {
    try {
      attachments.push(await downloadRemoteImage(url, {
        targetDir,
        source: 'image-link',
        originalUrl: url,
        fetchImpl: options.fetchImpl
      }));
    } catch (error) {
      console.error(
        `[media] 下载图片链接失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  for (const url of extractContentUrls(options.text).slice(0, MAX_URL_CONTENT_ATTACHMENTS)) {
    try {
      attachments.push(await downloadUrlContent(url, {
        targetDir,
        source: 'url-link',
        originalUrl: url,
        fetchImpl: options.fetchImpl
      }));
    } catch (error) {
      console.error(
        `[media] 下载链接内容失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return attachments;
}
