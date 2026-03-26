import assert from 'node:assert/strict';
import test from 'node:test';

import { extractWechatMessageText } from '../core/wechat-bridge.js';

test('extractWechatMessageText falls back to voice transcript when no text item exists', () => {
  const text = extractWechatMessageText([
    {
      type: 3,
      voice_item: {
        text: '这是微信自动转写出来的语音内容'
      }
    }
  ]);

  assert.equal(text, '这是微信自动转写出来的语音内容');
});

test('extractWechatMessageText combines text and voice transcript', () => {
  const text = extractWechatMessageText([
    {
      type: 1,
      text_item: {
        text: '补充说明'
      }
    },
    {
      type: 3,
      voice_item: {
        text: '这是语音转写'
      }
    }
  ]);

  assert.equal(text, '补充说明\n这是语音转写');
});
