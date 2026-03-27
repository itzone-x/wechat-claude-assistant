import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { downloadUrlContent } from '../dist/core/media.js';

const URLS = [
  'https://sk.3qdu.org/xiaoshuo/634434/106721696.html',
  'https://mp.weixin.qq.com/s/PPexdi1L_jtH4G_dX97UMQ',
  'https://sk.3qdu.org/',
  'https://example.com/',
  'https://playwright.dev/docs/intro',
  'https://tika.apache.org/',
  'https://github.com/mozilla/readability',
  'https://en.wikipedia.org/wiki/Web_scraping',
  'https://nodejs.org/en',
  'https://www.typescriptlang.org/docs/',
  'https://go.dev/doc/',
  'https://react.dev/',
  'https://kubernetes.io/docs/home/',
  'https://developer.mozilla.org/en-US/docs/Web/JavaScript',
  'https://www.rfc-editor.org/rfc/rfc9110.html',
  'https://sqlite.org/lang.html',
  'https://docs.python.org/3/',
  'https://pypi.org/project/requests/',
  'https://arxiv.org/abs/1706.03762',
  'https://news.ycombinator.com/'
];
const PER_URL_TIMEOUT_MS = 30_000;

function summarizePreview(preview) {
  const extractionStatus = preview.match(/^提取状态：(.+)$/m)?.[1] ?? '';
  const body = preview
    .replace(/^# .+$/m, '')
    .replace(/^标题：.+$/m, '')
    .replace(/^原始链接：.+$/m, '')
    .replace(/^MIME Type：.+$/m, '')
    .replace(/^提取状态：.+$/m, '')
    .replace(/^## 提取内容$/m, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return {
    extractionStatus,
    snippet: body.slice(0, 240).replace(/\n/g, ' ')
  };
}

const dir = await mkdtemp(join(tmpdir(), 'wechat-url-smoke-'));
const results = [];

for (const url of URLS) {
  try {
    const attachment = await Promise.race([
      downloadUrlContent(url, { targetDir: dir }),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout after ${PER_URL_TIMEOUT_MS}ms`)), PER_URL_TIMEOUT_MS))
    ]);
    const preview = await readFile(attachment.filePath, 'utf8');
    const { extractionStatus, snippet } = summarizePreview(preview);
    results.push({
      url,
      ok: true,
      title: attachment.title || '',
      extractionStatus,
      snippet
    });
  } catch (error) {
    results.push({
      url,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

for (const item of results) {
  console.log(`URL: ${item.url}`);
  if (!item.ok) {
    console.log(`STATUS: ERROR`);
    console.log(`ERROR: ${item.error}`);
    console.log('---');
    continue;
  }

  console.log(`STATUS: OK`);
  console.log(`TITLE: ${item.title}`);
  console.log(`EXTRACTION: ${item.extractionStatus || 'normal'}`);
  console.log(`SNIPPET: ${item.snippet}`);
  console.log('---');
}

const totals = {
  total: results.length,
  ok: results.filter((item) => item.ok).length,
  errors: results.filter((item) => !item.ok).length,
  degraded: results.filter((item) => item.ok && item.extractionStatus).length
};

console.log(`TOTAL=${totals.total} OK=${totals.ok} ERRORS=${totals.errors} DEGRADED=${totals.degraded}`);
