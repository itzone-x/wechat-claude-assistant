import assert from 'node:assert/strict';
import test from 'node:test';

import { buildConsoleQrPreview, buildQrHtml, resolveQrOpenTarget } from '../core/login-qr.js';

test('buildQrHtml renders terminal-style QR content as preformatted text', () => {
  const textQr = [
    '████ ████',
    '██  █  ██',
    '████ ████',
    '██  █  ██',
    '████ ████',
    '██  █  ██',
    '████ ████',
    '██  █  ██'
  ].join('\n');

  const html = buildQrHtml(textQr);

  assert.match(html, /<pre /);
  assert.doesNotMatch(html, /<img /);
  assert.equal(buildConsoleQrPreview(textQr), textQr);
});

test('buildQrHtml renders base64 image QR content as image tag', () => {
  const html = buildQrHtml('ZmFrZS1iYXNlNjQ=');

  assert.match(html, /<img /);
  assert.match(html, /data:image\/png;base64,ZmFrZS1iYXNlNjQ=/);
  assert.equal(buildConsoleQrPreview('ZmFrZS1iYXNlNjQ='), null);
});

test('buildQrHtml renders remote QR page URL as link instead of image', () => {
  const qrUrl = 'https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=abc123&bot_type=3';
  const html = buildQrHtml(qrUrl);

  assert.doesNotMatch(html, /<img /);
  assert.match(html, /打开微信二维码页面/);
  assert.match(html, /window\.location\.replace/);
  assert.equal(resolveQrOpenTarget(qrUrl, '/tmp/login-qrcode.html'), qrUrl);
});
