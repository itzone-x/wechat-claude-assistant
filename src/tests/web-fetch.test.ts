import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertSafeRemoteUrl,
  buildNetworkEnvCandidates,
  buildWebFetchInit,
  fetchRemoteBufferWithFallback
} from '../core/web-fetch.js';

test('buildNetworkEnvCandidates keeps inherited proxy env first by default', () => {
  const candidates = buildNetworkEnvCandidates({
    HTTP_PROXY: 'http://127.0.0.1:10808',
    HTTPS_PROXY: 'http://127.0.0.1:10808'
  });

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].HTTP_PROXY, 'http://127.0.0.1:10808');
  assert.equal(candidates[1].HTTP_PROXY, '');
});

test('buildNetworkEnvCandidates prefers bypass env first when requested', () => {
  const candidates = buildNetworkEnvCandidates({
    WECHAT_AGENT_BYPASS_PROXY: 'true',
    HTTP_PROXY: 'http://127.0.0.1:10808',
    HTTPS_PROXY: 'http://127.0.0.1:10808'
  });

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].HTTP_PROXY, '');
  assert.equal(candidates[1].HTTP_PROXY, 'http://127.0.0.1:10808');
});

test('fetchRemoteBufferWithFallback returns fetch result before curl fallback', async () => {
  let curlCalls = 0;
  const html = Buffer.from('<html>ok</html>');
  const result = await fetchRemoteBufferWithFallback(
    'https://example.com/article',
    async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
      text: async () => '',
      arrayBuffer: async () => html.buffer.slice(html.byteOffset, html.byteOffset + html.byteLength)
    }),
    {
      curlRunner: () => {
        curlCalls += 1;
        return {
          status: 0,
          stdout: Buffer.from('unexpected curl'),
          stderr: Buffer.alloc(0)
        };
      }
    }
  );

  assert.equal(result.transport, 'fetch');
  assert.equal(result.contentType, 'text/html; charset=utf-8');
  assert.equal(curlCalls, 0);
});

test('fetchRemoteBufferWithFallback falls back to curl and retries env candidates', async () => {
  const seenProxyValues: string[] = [];
  const result = await fetchRemoteBufferWithFallback(
    'https://example.com/article',
    async () => {
      throw new TypeError('fetch failed');
    },
    {
      baseEnv: {
        HTTP_PROXY: 'http://127.0.0.1:10808',
        HTTPS_PROXY: 'http://127.0.0.1:10808'
      },
      curlRunner: (_command, _args, options) => {
        seenProxyValues.push(options.env.HTTP_PROXY || '');
        if (options.env.HTTP_PROXY) {
          return {
            status: 7,
            stdout: Buffer.alloc(0),
            stderr: Buffer.from('proxy connect failed')
          };
        }

        return {
          status: 0,
          stdout: Buffer.from('<html>curl ok</html>'),
          stderr: Buffer.alloc(0)
        };
      }
    }
  );

  assert.equal(result.transport, 'curl');
  assert.equal(Buffer.from(result.buffer).toString('utf8'), '<html>curl ok</html>');
  assert.deepEqual(seenProxyValues, ['http://127.0.0.1:10808', '']);
});

test('buildWebFetchInit sets browser-like headers', () => {
  const init = buildWebFetchInit('https://example.com/demo');
  const headers = init.headers as Record<string, string>;

  assert.match(headers['User-Agent'], /Mozilla\/5\.0/);
  assert.equal(headers.Referer, 'https://example.com');
  assert.match(headers.Accept, /text\/html/);
});

test('assertSafeRemoteUrl rejects hostnames that resolve to private network addresses', async () => {
  await assert.rejects(
    assertSafeRemoteUrl('https://attacker.example/path', {
      lookupImpl: async () => [{ address: '192.168.1.25', family: 4 }]
    }),
    /禁止抓取本地或内网地址/
  );
});

test('assertSafeRemoteUrl allows public hostnames after DNS resolution', async () => {
  const parsed = await assertSafeRemoteUrl('https://example.com/path', {
    lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }]
  });

  assert.equal(parsed.hostname, 'example.com');
});
