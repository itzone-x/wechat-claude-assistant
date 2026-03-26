import test from 'node:test';
import assert from 'node:assert/strict';

import { buildLaunchdPlist, SERVICE_LABEL } from '../core/launchd.js';
import {
  analyzeChannelsSettings,
  CHANNEL_REPLY_TOOL_NAME,
  expectedChannelsFilesStatus
} from '../core/channels-validation.js';

test('buildLaunchdPlist includes service label and worker entrypoint', () => {
  const previousStateDir = process.env.WECHAT_AGENT_STATE_DIR;
  process.env.WECHAT_AGENT_STATE_DIR = '/tmp/wechat-agent-state';

  try {
    const plist = buildLaunchdPlist({
      mode: 'worker',
      workspacePolicy: 'current_project',
      workspaceRoot: '/tmp/project',
      approvalPolicy: 'sensitive_confirmation',
      preferredAutoStart: true,
      installedAt: '2026-03-25T00:00:00.000Z',
      updatedAt: '2026-03-25T00:00:00.000Z'
    });

    assert.match(plist, new RegExp(SERVICE_LABEL.replaceAll('.', '\\.')));
    assert.match(plist, /<string>start<\/string>/);
    assert.match(plist, /<string>--foreground<\/string>/);
    assert.match(plist, /WECHAT_AGENT_STATE_DIR/);
    assert.match(plist, /\/tmp\/project/);
  } finally {
    if (previousStateDir === undefined) {
      delete process.env.WECHAT_AGENT_STATE_DIR;
    } else {
      process.env.WECHAT_AGENT_STATE_DIR = previousStateDir;
    }
  }
});

test('analyzeChannelsSettings accepts current reply allowlist', () => {
  const result = analyzeChannelsSettings(JSON.stringify({
    permissions: {
      allow: [CHANNEL_REPLY_TOOL_NAME]
    }
  }));

  assert.equal(result.status, 'ok');
});

test('analyzeChannelsSettings warns on legacy allowlist', () => {
  const result = analyzeChannelsSettings(JSON.stringify({
    permissions: {
      allow: ['mcp__wechat-and-claude-code-holding-hands__wechat_get_messages']
    }
  }));

  assert.equal(result.status, 'warn');
  assert.match(result.detail, /旧的 channels 工具白名单/);
});

test('expectedChannelsFilesStatus validates plugin packaging', () => {
  assert.equal(expectedChannelsFilesStatus(true, true).status, 'ok');
  assert.equal(expectedChannelsFilesStatus(true, false).status, 'warn');
});
