import { createDecipheriv, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

import { DEFAULT_CDN_BASE_URL, getStatePaths } from './config.js';
import type { WorkerAttachment } from '../types/ilink.js';

const IMAGE_EXTENSION_RE = /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif)(?:$|[?#])/i;
const AUDIO_EXTENSION_RE = /\.(wav|mp3|ogg|m4a|aac|flac|silk)(?:$|[?#])/i;

interface FetchResponseLike {
  ok: boolean;
  status: number;
  headers: Pick<Headers, 'get'>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

type FetchLike = (
  input: string | URL,
  init?: RequestInit
) => Promise<FetchResponseLike>;

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

function defaultTargetDir(): string {
  return getStatePaths().attachmentsDir;
}

function isImageContentType(contentType: string | null | undefined): boolean {
  return Boolean(contentType && /^image\//i.test(contentType));
}

function looksLikeImageUrl(url: string): boolean {
  return IMAGE_EXTENSION_RE.test(url);
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
    'encrypt_query_param',
    'aeskey',
    'aes_key',
    'file_name'
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
  const base = basename(value || 'image', extname(value || ''));
  const sanitized = base.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitized || 'image';
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
  const searchRoot = { ...record };
  delete searchRoot.voice_item;
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
  const matches = text.match(/https?:\/\/[^\s<>"')]+/gi) || [];
  return unique(matches.filter((value) => looksLikeImageUrl(value)));
}

export async function downloadRemoteImage(
  url: string,
  options: DownloadRemoteImageOptions = {}
): Promise<WorkerAttachment> {
  const fetchImpl = options.fetchImpl || (globalThis.fetch as FetchLike | undefined);
  if (!fetchImpl) {
    throw new Error('当前环境不支持 fetch，无法下载图片。');
  }

  const response = await fetchImpl(url);
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

export async function resolveMessageAttachments(
  options: ResolveMessageAttachmentsOptions
): Promise<WorkerAttachment[]> {
  const attachments: WorkerAttachment[] = [];
  const targetDir = options.targetDir || defaultTargetDir();

  for (const item of options.itemList || []) {
    try {
      const imageCandidate = extractWechatImageCandidate(item);
      const voiceCandidate = extractWechatVoiceCandidate(item);
      if (!imageCandidate && !voiceCandidate) {
        continue;
      }

      const attachment = imageCandidate
        ? await downloadWechatImage(imageCandidate, {
            ...options,
            targetDir
          })
        : await downloadWechatVoice(voiceCandidate!, {
            ...options,
            targetDir
          });
      if (attachment) {
        attachments.push(attachment);
      }
    } catch (error) {
      console.error(
        `[media] 处理微信图片失败: ${error instanceof Error ? error.message : String(error)}`
      );
      const candidate = extractWechatImageCandidate(item) || extractWechatVoiceCandidate(item);
      if (candidate) {
        console.error(`[media] 微信图片候选字段: ${summarizeMediaCandidate(candidate, item)}`);
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

  return attachments;
}
