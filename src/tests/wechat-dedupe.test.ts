import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MessageDeduper,
  buildWechatMessageDedupKey,
  buildWechatMessageSemanticKey
} from '../core/wechat-bridge.js';

test('buildWechatMessageDedupKey prefers stable server ids when present', () => {
  const key = buildWechatMessageDedupKey({
    message_id: 12345,
    seq: 9,
    from_user_id: 'user-a',
    context_token: 'ctx-a',
    item_list: [
      {
        type: 1,
        text_item: {
          text: '你好'
        }
      }
    ]
  });

  assert.match(key, /mid:12345/);
});

test('buildWechatMessageDedupKey falls back to content fingerprint when ids are missing', () => {
  const first = buildWechatMessageDedupKey({
    from_user_id: 'user-a',
    context_token: 'ctx-a',
    create_time_ms: 1000,
    item_list: [
      {
        type: 1,
        text_item: {
          text: '你好'
        }
      }
    ]
  });

  const second = buildWechatMessageDedupKey({
    from_user_id: 'user-a',
    context_token: 'ctx-a',
    create_time_ms: 1001,
    item_list: [
      {
        type: 1,
        text_item: {
          text: '你好'
        }
      }
    ]
  });

  assert.notEqual(first, second);
});

test('buildWechatMessageSemanticKey stays stable when only delivery timestamps change', () => {
  const first = buildWechatMessageSemanticKey({
    from_user_id: 'user-a',
    context_token: 'ctx-a',
    create_time_ms: 1000,
    update_time_ms: 1000,
    item_list: [
      {
        type: 3,
        voice_item: {
          text: '帮我总结一下这段语音'
        }
      }
    ]
  });

  const second = buildWechatMessageSemanticKey({
    from_user_id: 'user-a',
    context_token: 'ctx-a',
    create_time_ms: 2000,
    update_time_ms: 3000,
    item_list: [
      {
        type: 3,
        voice_item: {
          text: '帮我总结一下这段语音'
        }
      }
    ]
  });

  assert.equal(first, second);
});

test('MessageDeduper suppresses repeated delivery of the same message', () => {
  const deduper = new MessageDeduper(60_000);
  const message = {
    message_id: 12345,
    from_user_id: 'user-a',
    context_token: 'ctx-a',
    item_list: [
      {
        type: 1,
        text_item: {
          text: '你好'
        }
      }
    ]
  };

  assert.equal(deduper.seen(message, 1_000), false);
  assert.equal(deduper.seen(message, 1_500), true);
});

test('MessageDeduper expires old fingerprints after ttl', () => {
  const deduper = new MessageDeduper(100);
  const message = {
    message_id: 12345,
    from_user_id: 'user-a',
    context_token: 'ctx-a',
    item_list: []
  };

  assert.equal(deduper.seen(message, 1_000), false);
  assert.equal(deduper.seen(message, 1_050), true);
  assert.equal(deduper.seen(message, 1_200), false);
});

test('MessageDeduper suppresses repeated delivery when only semantic content matches', () => {
  const deduper = new MessageDeduper(60_000, 8_000);
  const first = {
    from_user_id: 'user-a',
    context_token: 'ctx-a',
    create_time_ms: 1000,
    update_time_ms: 1000,
    item_list: [
      {
        type: 1,
        text_item: {
          text: '同一条消息'
        }
      }
    ]
  };
  const second = {
    from_user_id: 'user-a',
    context_token: 'ctx-a',
    create_time_ms: 2000,
    update_time_ms: 2000,
    item_list: [
      {
        type: 1,
        text_item: {
          text: '同一条消息'
        }
      }
    ]
  };

  assert.equal(deduper.seen(first, 1_000), false);
  assert.equal(deduper.seen(second, 1_500), true);
});

test('MessageDeduper snapshot persists recent semantic fingerprints', () => {
  const first = new MessageDeduper(60_000, 8_000);
  const message = {
    from_user_id: 'user-a',
    context_token: 'ctx-a',
    create_time_ms: 1000,
    item_list: [
      {
        type: 1,
        text_item: {
          text: '重启后也别重复处理'
        }
      }
    ]
  };

  assert.equal(first.seen(message, 1_000), false);

  const second = new MessageDeduper(60_000, 8_000, first.snapshot(1_500));
  assert.equal(second.seen({
    ...message,
    create_time_ms: 1200,
    update_time_ms: 1300
  }, 1_600), true);
});
