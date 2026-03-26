import test from 'node:test';
import assert from 'node:assert/strict';

import { getChannelsHelpText } from '../commands/channels.js';
import {
  buildChannelsMcpEntry,
  mergeChannelsMcpConfig,
  mergeChannelsSettings
} from '../core/channels-config.js';
import {
  CHANNEL_REPLY_TOOL_NAME,
  LEGACY_CHANNEL_MESSAGE_TOOL_NAME,
  LEGACY_CHANNEL_REPLY_TOOL_NAME
} from '../core/channels-validation.js';

test('buildChannelsMcpEntry points to cli channels mode', () => {
  const entry = buildChannelsMcpEntry('/tmp/project');
  assert.equal(entry.command, 'node');
  assert.deepEqual(entry.args, [
    '/tmp/project/dist/cli.js',
    'start',
    '--mode',
    'channels'
  ]);
});

test('mergeChannelsMcpConfig preserves existing servers and overwrites wechat entry', () => {
  const config = mergeChannelsMcpConfig({
    mcpServers: {
      github: { command: 'node', args: ['github.js'] },
      wechat: { command: 'old' }
    }
  }, '/tmp/project');

  assert.deepEqual(config.mcpServers?.github, { command: 'node', args: ['github.js'] });
  assert.deepEqual(config.mcpServers?.wechat, buildChannelsMcpEntry('/tmp/project'));
});

test('mergeChannelsSettings adds current reply tool and removes legacy ones', () => {
  const settings = mergeChannelsSettings({
    permissions: {
      allow: [
        LEGACY_CHANNEL_MESSAGE_TOOL_NAME,
        LEGACY_CHANNEL_REPLY_TOOL_NAME,
        'mcp__github__list_pull_requests'
      ]
    },
    custom: true
  });

  assert.equal(settings.custom, true);
  assert.deepEqual(settings.permissions?.allow, [
    'mcp__github__list_pull_requests',
    CHANNEL_REPLY_TOOL_NAME
  ]);
});

test('mergeChannelsSettings deduplicates reply tool', () => {
  const settings = mergeChannelsSettings({
    permissions: {
      allow: [CHANNEL_REPLY_TOOL_NAME, CHANNEL_REPLY_TOOL_NAME]
    }
  });

  assert.deepEqual(settings.permissions?.allow, [CHANNEL_REPLY_TOOL_NAME]);
});

test('channels help text marks the command as advanced mode', () => {
  const help = getChannelsHelpText();

  assert.match(help, /高级模式/);
  assert.match(help, /默认推荐路径仍然是 `node dist\/cli\.js start`/);
});
