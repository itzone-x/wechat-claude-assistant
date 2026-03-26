import test from 'node:test';
import assert from 'node:assert/strict';

import type { WorkerMessage } from '../types/ilink.js';
import {
  buildChannelNotification,
  buildPermissionPrompt,
  parsePermissionReply,
  WechatChannelBridge
} from '../adapters/channels/bridge.js';

function createBridge(options?: {
  pairedUsers?: string[];
}) {
  const notifications: unknown[] = [];
  const replies: Array<{ text: string; toUserId?: string; contextToken?: string }> = [];
  const pairedUsers = new Set(options?.pairedUsers || ['user-123']);

  const bridge = new WechatChannelBridge({
    isPairedUser: async (userId) => pairedUsers.has(userId),
    sendReply: async (text, toUserId, contextToken) => {
      replies.push({ text, toUserId, contextToken });
      return { ret: 0 };
    },
    emitNotification: async (notification) => {
      notifications.push(notification);
    }
  });

  return { bridge, notifications, replies };
}

function message(overrides?: Partial<WorkerMessage>): WorkerMessage {
  return {
    fromUserId: 'user-123',
    text: '你好，帮我看一下当前仓库',
    contextToken: 'ctx-456',
    ...overrides
  };
}

test('parsePermissionReply parses allow replies', () => {
  assert.deepEqual(
    parsePermissionReply('yes a1b2c'),
    { requestId: 'a1b2c', behavior: 'allow' }
  );
  assert.deepEqual(
    parsePermissionReply('Y ABC12'),
    { requestId: 'ABC12', behavior: 'allow' }
  );
});

test('parsePermissionReply parses deny replies', () => {
  assert.deepEqual(
    parsePermissionReply('no z9x8y'),
    { requestId: 'z9x8y', behavior: 'deny' }
  );
});

test('parsePermissionReply ignores normal chat text', () => {
  assert.equal(parsePermissionReply('帮我修一下这个 bug'), null);
  assert.equal(parsePermissionReply('yes'), null);
});

test('buildPermissionPrompt includes tool and request id', () => {
  const prompt = buildPermissionPrompt({
    request_id: 'abc12',
    tool_name: 'bash',
    input_preview: 'npm run build',
    description: 'Run the build command'
  });

  assert.match(prompt, /bash/);
  assert.match(prompt, /abc12/);
  assert.match(prompt, /npm run build/);
  assert.match(prompt, /yes abc12/);
  assert.match(prompt, /no abc12/);
});

test('buildChannelNotification emits user message with metadata', () => {
  const notification = buildChannelNotification(message());

  assert.equal(notification.method, 'notifications/claude/channel');
  assert.equal(notification.params.message.role, 'user');
  assert.equal(notification.params.message.content[0].type, 'text');
  assert.equal(notification.params.message.content[0].text, '你好，帮我看一下当前仓库');
  assert.deepEqual(notification.params.metadata, {
    chat_id: 'user-123',
    sender_id: 'user-123',
    context_token: 'ctx-456'
  });
});

test('buildChannelNotification includes attachment hints for multimodal messages', () => {
  const notification = buildChannelNotification(message({
    text: '请看图',
    attachments: [{
      type: 'image',
      source: 'wechat-upload',
      filePath: '/tmp/wechat-agent-media/demo.png',
      mimeType: 'image/png'
    }]
  }));

  assert.equal(notification.params.message.content[0].type, 'text');
  assert.match(notification.params.message.content[0].text, /请看图/);
  assert.match(notification.params.message.content[0].text, /图片 1/);
  assert.match(notification.params.message.content[0].text, /\/tmp\/wechat-agent-media\/demo\.png/);
});

test('bridge forwards paired inbound message as channel notification', async () => {
  const { bridge, notifications, replies } = createBridge();

  await bridge.handleWechatMessage(message());

  assert.equal(replies.length, 0);
  assert.equal(notifications.length, 1);
  assert.deepEqual(notifications[0], buildChannelNotification(message()));
  assert.equal(bridge.getLatestChatContext()?.chatId, 'user-123');
});

test('bridge ignores unpaired users', async () => {
  const { bridge, notifications, replies } = createBridge({ pairedUsers: [] });

  await bridge.handleWechatMessage(message());

  assert.equal(notifications.length, 0);
  assert.equal(replies.length, 0);
});

test('bridge sends permission prompt to latest active chat', async () => {
  const { bridge, replies } = createBridge();

  await bridge.handleWechatMessage(message());
  const ok = await bridge.handlePermissionRequest({
    request_id: 'abc12',
    tool_name: 'bash',
    input_preview: 'npm run build',
    description: 'Run build'
  });

  assert.equal(ok, true);
  assert.equal(replies.length, 1);
  assert.match(replies[0].text, /yes abc12/);
  assert.equal(bridge.getPendingPermissionContext('abc12')?.chatId, 'user-123');
});

test('bridge routes yes/no approval replies back as permission notifications', async () => {
  const { bridge, notifications, replies } = createBridge();

  await bridge.handleWechatMessage(message());
  await bridge.handlePermissionRequest({
    request_id: 'abc12',
    tool_name: 'bash',
    input_preview: 'npm run build',
    description: 'Run build'
  });

  notifications.length = 0;
  replies.length = 0;

  await bridge.handleWechatMessage(message({ text: 'yes abc12' }));

  assert.equal(notifications.length, 1);
  assert.deepEqual(notifications[0], {
    method: 'notifications/claude/channel/permission',
    params: {
      request_id: 'abc12',
      behavior: 'allow'
    }
  });
  assert.equal(replies.length, 1);
  assert.match(replies[0].text, /已记录审批: yes abc12/);
  assert.equal(bridge.getPendingPermissionContext('abc12'), null);
});

test('bridge rejects approval code from another chat', async () => {
  const { bridge, notifications, replies } = createBridge({
    pairedUsers: ['user-123', 'user-999']
  });

  await bridge.handleWechatMessage(message());
  await bridge.handlePermissionRequest({
    request_id: 'abc12',
    tool_name: 'bash',
    input_preview: 'npm run build',
    description: 'Run build'
  });

  notifications.length = 0;
  replies.length = 0;

  await bridge.handleWechatMessage(message({
    fromUserId: 'user-999',
    text: 'no abc12',
    contextToken: 'ctx-999'
  }));

  assert.equal(notifications.length, 0);
  assert.equal(replies.length, 1);
  assert.match(replies[0].text, /不属于当前微信会话/);
});

test('bridge rejects unknown approval code', async () => {
  const { bridge, notifications, replies } = createBridge();

  await bridge.handleWechatMessage(message({ text: 'yes abc12' }));

  assert.equal(notifications.length, 0);
  assert.equal(replies.length, 1);
  assert.match(replies[0].text, /不存在或已过期/);
});

test('bridge reply tool uses cached context token when omitted', async () => {
  const { bridge, replies } = createBridge();

  await bridge.handleWechatMessage(message());
  const result = await bridge.handleReplyTool({
    chat_id: 'user-123',
    text: '已经处理完成'
  });

  assert.equal(result.content[0].text, '已发送到微信会话 user-123');
  assert.equal(replies[0].toUserId, 'user-123');
  assert.equal(replies[0].contextToken, 'ctx-456');
});
