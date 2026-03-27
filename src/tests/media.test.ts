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

test('downloadUrlContent rejects localhost targets for safety', async () => {
  await assert.rejects(
    downloadUrlContent('http://127.0.0.1/private', {
      fetchImpl: async () => {
        throw new Error('should not fetch');
      }
    }),
    /禁止抓取本地或内网地址/
  );
});

test('downloadRemoteImage rejects user-supplied localhost image links', async () => {
  await assert.rejects(
    downloadRemoteImage('http://127.0.0.1/demo.png', {
      source: 'image-link',
      fetchImpl: async () => {
        throw new Error('should not fetch');
      }
    }),
    /禁止抓取本地或内网地址/
  );
});

test('downloadUrlContent stores html as a webpage attachment', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wechat-agent-webpage-'));
  const html = '<html><head><title>演示文章</title></head><body><h1>标题</h1><p>第一段</p><p>第二段</p></body></html>';
  const attachment = await downloadUrlContent('https://example.com/article', {
    targetDir: dir,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
      text: async () => '',
      arrayBuffer: async () => {
        const encoded = new TextEncoder().encode(html);
        return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
      }
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

test('downloadUrlContent prefers article-like html regions and strips boilerplate', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wechat-agent-webpage-article-'));
  const html = `
    <html>
      <head>
        <title>公众号文章标题</title>
        <meta name="description" content="文章摘要">
      </head>
      <body>
        <nav>站点导航</nav>
        <div id="js_content">
          <p>第一段正文</p>
          <p>第二段正文</p>
        </div>
        <footer>版权信息</footer>
      </body>
    </html>
  `;
  const attachment = await downloadUrlContent('https://example.com/wechat-article', {
    targetDir: dir,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
      text: async () => '',
      arrayBuffer: async () => {
        const encoded = new TextEncoder().encode(html);
        return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
      }
    })
  });

  assert.equal(attachment.type, 'webpage');
  const saved = await readFile(attachment.filePath, 'utf8');
  assert.match(saved, /公众号文章标题/);
  assert.match(saved, /文章摘要/);
  assert.match(saved, /第一段正文/);
  assert.match(saved, /第二段正文/);
  assert.doesNotMatch(saved, /站点导航/);
  assert.doesNotMatch(saved, /版权信息/);
});

test('downloadUrlContent decodes gbk html pages correctly', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wechat-agent-webpage-gbk-'));
  const gbkHtml = Uint8Array.from([
    60, 104, 116, 109, 108, 62, 60, 104, 101, 97, 100, 62, 60, 109, 101, 116, 97, 32, 99, 104, 97, 114, 115,
    101, 116, 61, 34, 103, 98, 107, 34, 62, 60, 116, 105, 116, 108, 101, 62, 181, 218, 53, 213, 194, 32, 177,
    234, 204, 226, 60, 47, 116, 105, 116, 108, 101, 62, 60, 47, 104, 101, 97, 100, 62, 60, 98, 111, 100, 121,
    62, 60, 100, 105, 118, 32, 105, 100, 61, 34, 110, 111, 118, 101, 108, 99, 111, 110, 116, 101, 110, 116, 34,
    62, 60, 112, 62, 196, 227, 186, 195, 163, 172, 202, 192, 189, 231, 161, 163, 60, 47, 112, 62, 60, 112, 62,
    213, 226, 202, 199, 213, 253, 206, 196, 161, 163, 60, 47, 112, 62, 60, 47, 100, 105, 118, 62, 60, 47, 98,
    111, 100, 121, 62, 60, 47, 104, 116, 109, 108, 62
  ]);

  const attachment = await downloadUrlContent('https://example.com/chapter.html', {
    targetDir: dir,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html; charset=gbk' }),
      text: async () => '',
      arrayBuffer: async () => gbkHtml.buffer.slice(
        gbkHtml.byteOffset,
        gbkHtml.byteOffset + gbkHtml.byteLength
      )
    })
  });

  assert.equal(attachment.type, 'webpage');
  assert.equal(attachment.title, '第5章 标题');
  const saved = await readFile(attachment.filePath, 'utf8');
  assert.match(saved, /第5章 标题/);
  assert.match(saved, /你好，世界。/);
  assert.match(saved, /这是正文。/);
});

test('downloadUrlContent extracts title and body from wechat article style html', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wechat-agent-webpage-wechat-mp-'));
  const attachment = await downloadUrlContent('https://mp.weixin.qq.com/s/example', {
    targetDir: dir,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
      text: async () => '',
      arrayBuffer: async () => {
        const encoded = Buffer.from(`
          <html>
            <head>
              <title></title>
              <meta property="og:title" content="徐小明：看下周吧(0327)" />
              <meta property="og:type" content="article" />
            </head>
            <body>
              <div id="img-content" class="rich_media_wrp">
                <h1 class="rich_media_title" id="activity-name">
                  <span class="js_title_inner">徐小明：看下周吧(0327)</span>
                </h1>
                <div id="js_content" class="rich_media_content" style="visibility: hidden; opacity: 0;">
                  <p>昨天夜里美股大跌，A股早盘表现得不错，低开之后直接走高。</p>
                  <p>市场走4浪反弹还是5浪下跌，还是看下周。</p>
                </div>
              </div>
            </body>
          </html>
        `);
        return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
      }
    })
  });

  assert.equal(attachment.type, 'webpage');
  assert.equal(attachment.title, '徐小明：看下周吧(0327)');
  const saved = await readFile(attachment.filePath, 'utf8');
  assert.match(saved, /徐小明：看下周吧\(0327\)/);
  assert.match(saved, /A股早盘表现得不错/);
  assert.match(saved, /还是看下周/);
});

test('downloadUrlContent follows next-page hints when first page only shows pagination placeholder', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wechat-agent-webpage-pagination-'));
  const responses = new Map<string, string>([
    ['https://example.com/chapter.html', `
      <html>
        <head><meta charset="utf-8"><title>第5章 标题</title></head>
        <body>
          <div id="novelcontent">
            <p>本章未完 点击下一页继续阅读</p>
          </div>
          <script>var next_page = "/chapter_2.html";</script>
        </body>
      </html>
    `],
    ['https://example.com/chapter_2.html', `
      <html>
        <head><meta charset="utf-8"><title>第5章 标题</title></head>
        <body>
          <div id="novelcontent">
            <p>主角在这一章开始尝试用婚姻占卜术推断缘分。</p>
            <p>他发现术法并不能直接改命，只能提示因果与选择。</p>
          </div>
        </body>
      </html>
    `]
  ]);

  const attachment = await downloadUrlContent('https://example.com/chapter.html', {
    targetDir: dir,
    fetchImpl: async (input) => {
      const html = responses.get(String(input));
      if (!html) {
        throw new Error(`unexpected url: ${String(input)}`);
      }
      const encoded = Buffer.from(html);
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
        text: async () => '',
        arrayBuffer: async () => encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength)
      } as Response;
    }
  });

  const saved = await readFile(attachment.filePath, 'utf8');
  assert.match(saved, /主角在这一章开始尝试用婚姻占卜术推断缘分/);
  assert.match(saved, /术法并不能直接改命/);
  assert.doesNotMatch(saved, /本章未完 点击下一页继续阅读/);
  assert.doesNotMatch(saved, /提取状态：正文缺失/);
});

test('downloadUrlContent writes explicit warning when source page does not expose body text', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wechat-agent-webpage-missing-body-'));
  const attachment = await downloadUrlContent('https://example.com/empty-chapter.html', {
    targetDir: dir,
    fetchImpl: async () => {
      const encoded = Buffer.from(`
        <html>
          <head><meta charset="utf-8"><title>第5章 标题</title></head>
          <body>
            <div id="novelcontent">
              <p>本章未完 点击下一页继续阅读</p>
            </div>
          </body>
        </html>
      `);
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
        text: async () => '',
        arrayBuffer: async () => encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength)
      } as Response;
    }
  });

  const saved = await readFile(attachment.filePath, 'utf8');
  assert.match(saved, /提取状态：正文缺失或源站未公开正文/);
  assert.match(saved, /未能从源站公开 HTML 中提取到正文内容/);
  assert.match(saved, /不要根据标题、目录或站点框架推断正文细节/);
});

test('downloadUrlContent uses browser-render fallback when html body is missing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wechat-agent-webpage-browser-fallback-'));
  const browserCalls: string[] = [];

  const attachment = await downloadUrlContent('https://example.com/spa-article', {
    targetDir: dir,
    fetchImpl: async () => {
      const encoded = Buffer.from(`
        <html>
          <head><meta charset="utf-8"><title>动态文章</title></head>
          <body>
            <div id="root">Loading...</div>
          </body>
        </html>
      `);
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
        text: async () => '',
        arrayBuffer: async () => encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength)
      } as Response;
    },
    browserRender: async (url) => {
      browserCalls.push(url);
      return {
        html: `
          <html>
            <head><meta charset="utf-8"><title>动态文章</title></head>
            <body>
              <article>
                <p>第一段正文通过浏览器渲染后才出现。</p>
                <p>第二段正文说明这是一个依赖脚本执行的文章页。</p>
              </article>
            </body>
          </html>
        `,
        finalUrl: url
      };
    }
  });

  assert.deepEqual(browserCalls, ['https://example.com/spa-article']);
  const saved = await readFile(attachment.filePath, 'utf8');
  assert.match(saved, /第一段正文通过浏览器渲染后才出现/);
  assert.match(saved, /依赖脚本执行的文章页/);
  assert.doesNotMatch(saved, /提取状态：正文缺失或源站未公开正文/);
});

test('downloadUrlContent skips browser fallback for known 3qdu placeholder chapters', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wechat-agent-webpage-3qdu-fast-degrade-'));
  const browserCalls: string[] = [];

  const attachment = await downloadUrlContent('https://sk.3qdu.org/xiaoshuo/634434/106721696.html', {
    targetDir: dir,
    fetchImpl: async () => {
      const encoded = Buffer.from(`
        <html>
          <head><meta charset="utf-8"><title>第5章 婚姻占卜术（术）</title></head>
          <body>
            <div id="novelcontent">
              <p>本章未完 点击下一页继续阅读</p>
            </div>
          </body>
        </html>
      `);
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
        text: async () => '',
        arrayBuffer: async () => encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength)
      } as Response;
    },
    browserRender: async (url) => {
      browserCalls.push(url);
      return {
        html: '<html><body><article><p>不应该进入浏览器回退</p></article></body></html>',
        finalUrl: url
      };
    }
  });

  assert.deepEqual(browserCalls, []);
  const saved = await readFile(attachment.filePath, 'utf8');
  assert.match(saved, /提取状态：正文缺失或源站未公开正文/);
  assert.match(saved, /未能从源站公开 HTML 中提取到正文内容/);
});

test('downloadUrlContent treats title-only novel metadata pages as missing body', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wechat-agent-webpage-metadata-only-'));
  const attachment = await downloadUrlContent('https://example.com/novel/chapter-5.html', {
    targetDir: dir,
    fetchImpl: async () => {
      const encoded = Buffer.from(`
        <html>
          <head>
            <meta charset="utf-8">
            <title>《改命记实录》第5章：婚姻占卜术（术）_道之光_3Q中文网</title>
          </head>
          <body>
            <div id="novelcontent">
              <p>本章未完 点击下一页继续阅读</p>
            </div>
          </body>
        </html>
      `);
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
        text: async () => '',
        arrayBuffer: async () => encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength)
      } as Response;
    }
  });

  const saved = await readFile(attachment.filePath, 'utf8');
  assert.match(saved, /提取状态：正文缺失或源站未公开正文/);
  assert.match(saved, /不要根据标题、目录或站点框架推断正文细节/);
});

test('downloadUrlContent treats repeated navigation-only chrome as missing body', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wechat-agent-webpage-nav-only-'));
  const attachment = await downloadUrlContent('https://example.com/nav-only.html', {
    targetDir: dir,
    fetchImpl: async () => {
      const encoded = Buffer.from(`
        <html>
          <head>
            <meta charset="utf-8">
            <title>第5章 婚姻占卜术（术）</title>
          </head>
          <body>
            <div id="novelcontent">首页 我的书架 阅读历史 首页 我的书架 阅读历史</div>
          </body>
        </html>
      `);
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
        text: async () => '',
        arrayBuffer: async () => encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength)
      } as Response;
    }
  });

  const saved = await readFile(attachment.filePath, 'utf8');
  assert.match(saved, /提取状态：正文缺失或源站未公开正文/);
  assert.match(saved, /未能从源站公开 HTML 中提取到正文内容/);
});

test('downloadUrlContent preserves long article bodies extracted by readability', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wechat-agent-webpage-readability-'));
  const attachment = await downloadUrlContent('https://example.com/encyclopedia.html', {
    targetDir: dir,
    fetchImpl: async () => {
      const encoded = Buffer.from(`
        <html>
          <head>
            <meta charset="utf-8">
            <title>Web scraping</title>
          </head>
          <body>
            <article>
              <p>Web scraping is a process of extracting data from websites and transforming it into a structured format for later analysis.</p>
              <p>It is commonly used in search, market intelligence, monitoring, and research workflows where a human would otherwise have to manually copy information from many pages.</p>
              <p>Typical implementations combine HTTP retrieval, HTML parsing, normalization, deduplication, and storage, and may optionally add browser automation for pages that depend on JavaScript rendering.</p>
            </article>
          </body>
        </html>
      `);
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
        text: async () => '',
        arrayBuffer: async () => encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength)
      } as Response;
    }
  });

  const saved = await readFile(attachment.filePath, 'utf8');
  assert.doesNotMatch(saved, /提取状态：正文缺失或源站未公开正文/);
  assert.match(saved, /Web scraping is a process of extracting data from websites/);
  assert.match(saved, /browser automation for pages that depend on JavaScript rendering/);
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
  const html = '<html><head><title>文章标题</title></head><body><p>正文段落</p></body></html>';
  const attachments = await resolveMessageAttachments({
    text: '请看 https://example.com/article',
    itemList: [],
    targetDir: dir,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html' }),
      text: async () => '',
      arrayBuffer: async () => {
        const encoded = Buffer.from(html);
        return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
      }
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
