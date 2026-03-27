import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createCipheriv } from 'node:crypto';

import {
  downloadUrlContent,
  extractContentUrls,
  downloadRemoteImage,
  extractImageUrls,
  resolveMessageAttachments
} from '../core/media.js';

test('extractImageUrls keeps image-like links and drops normal pages', () => {
  const urls = extractImageUrls(
    [
      '帮我看这两张图：',
      'https://example.com/a.png',
      'https://example.com/b.jpeg?size=large',
      'https://example.com/page.html'
    ].join(' ')
  );

  assert.deepEqual(urls, [
    'https://example.com/a.png',
    'https://example.com/b.jpeg?size=large'
  ]);
});

test('extractContentUrls keeps normal URLs and drops image-like links', () => {
  const urls = extractContentUrls(
    [
      '帮我看两个链接：',
      'https://example.com/article',
      'https://example.com/report.pdf',
      'https://example.com/picture.png'
    ].join(' ')
  );

  assert.deepEqual(urls, [
    'https://example.com/article',
    'https://example.com/report.pdf'
  ]);
});

test('downloadRemoteImage stores a fetched image as local attachment', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wechat-agent-media-'));
  const attachment = await downloadRemoteImage('https://example.com/demo.png', {
    targetDir: dir,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/png' }),
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer
    }) as Response
  });

  assert.equal(attachment.type, 'image');
  assert.equal(attachment.source, 'image-link');
  assert.match(attachment.filePath, /\.png$/);
  const saved = await readFile(attachment.filePath);
  assert.deepEqual(Array.from(saved), [1, 2, 3, 4]);
});

test('downloadUrlContent stores html as a webpage attachment', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wechat-agent-webpage-'));
  const attachment = await downloadUrlContent('https://example.com/article', {
    targetDir: dir,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
      text: async () => '<html><head><title>演示文章</title></head><body><h1>标题</h1><p>第一段</p><p>第二段</p></body></html>',
      arrayBuffer: async () => new TextEncoder().encode('').buffer
    })
  });

  assert.equal(attachment.type, 'webpage');
  assert.equal(attachment.source, 'url-link');
  assert.equal(attachment.title, '演示文章');
  assert.match(attachment.filePath, /\.md$/);
  const saved = await readFile(attachment.filePath, 'utf8');
  assert.match(saved, /演示文章/);
  assert.match(saved, /第一段/);
});

test('downloadRemoteImage sniffs image type from bytes when content-type is missing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wechat-agent-media-sniff-'));
  const pngBytes = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d
  ]);

  const attachment = await downloadRemoteImage('https://example.com/download?id=1', {
    targetDir: dir,
    fileName: 'image-without-extension',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      arrayBuffer: async () => pngBytes.buffer
    }) as Response
  });

  assert.equal(attachment.mimeType, 'image/png');
  assert.match(attachment.filePath, /\.png$/);
});

test('resolveMessageAttachments collects both native image items and linked images', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wechat-agent-msg-media-'));
  const fetchedUrls: string[] = [];

  const attachments = await resolveMessageAttachments({
    text: '请一起看 https://example.com/from-link.jpg',
    itemList: [
      {
        image_item: {
          image_url: 'https://example.com/from-wechat.png',
          file_name: 'wechat.png'
        }
      }
    ],
    targetDir: dir,
    fetchImpl: async (input) => {
      fetchedUrls.push(String(input));
      return {
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': String(input).includes('png') ? 'image/png' : 'image/jpeg'
        }),
        arrayBuffer: async () => new Uint8Array([8, 6, 7, 5]).buffer
      } as Response;
    }
  });

  assert.equal(attachments.length, 2);
  assert.deepEqual(attachments.map((item) => item.source), ['wechat-upload', 'image-link']);
  assert.deepEqual(fetchedUrls, [
    'https://example.com/from-wechat.png',
    'https://example.com/from-link.jpg'
  ]);
});

test('resolveMessageAttachments supports nested media records with non-image_item keys', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wechat-agent-msg-media-nested-'));
  const attachments = await resolveMessageAttachments({
    text: '',
    itemList: [
      {
        type: 3,
        pic_item: {
          media: {
            pic_url: 'https://example.com/from-pic-item.webp',
            file_name: 'nested.webp'
          }
        }
      }
    ],
    targetDir: dir,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/webp' }),
      arrayBuffer: async () => new Uint8Array([4, 2, 4, 2]).buffer
    }) as Response
  });

  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].source, 'wechat-upload');
  assert.match(attachments[0].filePath, /\.webp$/);
});

test('resolveMessageAttachments downloads uploaded file items as document previews', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wechat-agent-msg-file-'));
  const attachments = await resolveMessageAttachments({
    text: '',
    itemList: [
      {
        type: 4,
        file_item: {
          file_name: 'notes.md',
          download_url: 'https://example.com/files/notes.md',
          mime_type: 'text/markdown'
        }
      }
    ],
    targetDir: dir,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/markdown' }),
      text: async () => '# note',
      arrayBuffer: async () => Buffer.from('# 文档标题\n\n正文内容').buffer
    }) as Response
  });

  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].type, 'document');
  assert.equal(attachments[0].source, 'wechat-upload');
  assert.ok(attachments[0].originalFilePath);
  const preview = await readFile(attachments[0].filePath, 'utf8');
  assert.match(preview, /正文内容/);
  assert.match(preview, /原始附件路径/);
});

test('resolveMessageAttachments downloads normal URLs as webpage attachments', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wechat-agent-msg-url-'));
  const attachments = await resolveMessageAttachments({
    text: '请看 https://example.com/article',
    itemList: [],
    targetDir: dir,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html' }),
      text: async () => '<html><head><title>文章标题</title></head><body><p>正文段落</p></body></html>',
      arrayBuffer: async () => Buffer.from('').buffer
    }) as Response
  });

  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].type, 'webpage');
  const preview = await readFile(attachments[0].filePath, 'utf8');
  assert.match(preview, /文章标题/);
  assert.match(preview, /正文段落/);
});

test('resolveMessageAttachments treats opaque pic_url token as encrypted query param', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wechat-agent-msg-media-token-'));
  const requestedUrls: string[] = [];

  const attachments = await resolveMessageAttachments({
    text: '',
    itemList: [
      {
        image_item: {
          pic_url: '3057020100044b30490201000204b51cc30e02032f5b710204b17810da',
          file_name: 'opaque-token'
        }
      }
    ],
    targetDir: dir,
    baseUrl: 'https://ilinkai.weixin.qq.com/media/download',
    fetchImpl: async (input) => {
      requestedUrls.push(String(input));
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/octet-stream' }),
        arrayBuffer: async () => Buffer.alloc(16).buffer
      } as Response;
    }
  });

  assert.equal(attachments.length, 1);
  assert.match(requestedUrls[0] ?? '', /\/download\?encrypted_query_param=3057020100044b30/);
});

test('resolveMessageAttachments defaults wechat media downloads to the CDN host', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wechat-agent-msg-media-default-cdn-'));
  const requestedUrls: string[] = [];

  const attachments = await resolveMessageAttachments({
    text: '',
    itemList: [
      {
        image_item: {
          media: {
            encrypt_query_param: 'opaque-token',
            file_name: 'demo-image'
          }
        }
      }
    ],
    targetDir: dir,
    fetchImpl: async (input) => {
      requestedUrls.push(String(input));
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'image/png' }),
        arrayBuffer: async () => new Uint8Array([1, 1, 2, 3]).buffer
      } as Response;
    }
  });

  assert.equal(attachments.length, 1);
  assert.match(requestedUrls[0] ?? '', /^https:\/\/novac2c\.cdn\.weixin\.qq\.com\/c2c\/download\?encrypted_query_param=/);
});

test('resolveMessageAttachments accepts media aes_key encoded as base64 hex-string', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wechat-agent-msg-media-aes-key-'));
  const encrypted = Buffer.from('hello from image');
  const aesKeyRaw = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  const cipher = await import('node:crypto').then(({ createCipheriv }) => {
    const instance = createCipheriv('aes-128-ecb', aesKeyRaw, null);
    instance.setAutoPadding(true);
    return Buffer.concat([instance.update(encrypted), instance.final()]);
  });
  const aesKeyBase64OfHex = Buffer.from('00112233445566778899aabbccddeeff', 'ascii').toString('base64');

  const attachments = await resolveMessageAttachments({
    text: '',
    itemList: [
      {
        image_item: {
          media: {
            encrypt_query_param: 'opaque-token',
            aes_key: aesKeyBase64OfHex,
            file_name: 'encrypted-image'
          }
        }
      }
    ],
    targetDir: dir,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/octet-stream' }),
      arrayBuffer: async () => cipher.buffer.slice(
        cipher.byteOffset,
        cipher.byteOffset + cipher.byteLength
      )
    }) as Response
  });

  assert.equal(attachments.length, 1);
  const saved = await readFile(attachments[0].filePath);
  assert.equal(saved.toString('utf-8'), 'hello from image');
});

test('resolveMessageAttachments downloads voice media as audio attachment', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wechat-agent-msg-voice-'));
  const requestedUrls: string[] = [];
  const plaintext = Buffer.from('fake silk audio payload');
  const aesKey = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  const encrypted = (() => {
    const cipher = createCipheriv('aes-128-ecb', aesKey, null);
    cipher.setAutoPadding(true);
    return Buffer.concat([cipher.update(plaintext), cipher.final()]);
  })();

  const attachments = await resolveMessageAttachments({
    text: '',
    itemList: [
      {
        type: 3,
        voice_item: {
          media: {
            encrypt_query_param: 'voice-opaque-token',
            aes_key: aesKey.toString('base64')
          }
        }
      }
    ],
    targetDir: dir,
    fetchImpl: async (input) => {
      requestedUrls.push(String(input));
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        arrayBuffer: async () => encrypted.buffer.slice(
          encrypted.byteOffset,
          encrypted.byteOffset + encrypted.byteLength
        )
      } as Response;
    }
  });

  assert.equal(attachments.length, 1);
  assert.equal(attachments[0]?.type, 'audio');
  assert.equal(attachments[0]?.mimeType, 'audio/silk');
  assert.match(attachments[0]?.filePath ?? '', /\.silk$/);
  const saved = await readFile(attachments[0]!.filePath);
  assert.equal(saved.toString('utf-8'), 'fake silk audio payload');
  assert.match(requestedUrls[0] ?? '', /\/download\?encrypted_query_param=voice-opaque-token/);
});
