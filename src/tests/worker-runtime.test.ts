import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { buildDoctorGuidance } from '../commands/doctor.js';
import { getStatePaths } from '../core/config.js';
import {
  ClaudeCodeRunner,
  resolveClaudeCommand
} from '../runtime/claude-code-runner.js';

async function withStateDir<T>(fn: (stateDir: string) => Promise<T>): Promise<T> {
  const previous = process.env.WECHAT_AGENT_STATE_DIR;
  const stateDir = await mkdtemp(join(tmpdir(), 'wechat-agent-worker-runtime-'));
  process.env.WECHAT_AGENT_STATE_DIR = stateDir;
  try {
    return await fn(stateDir);
  } finally {
    if (previous === undefined) {
      delete process.env.WECHAT_AGENT_STATE_DIR;
    } else {
      process.env.WECHAT_AGENT_STATE_DIR = previous;
    }
  }
}

function fixturePath(name: string): string {
  const testDir = dirname(fileURLToPath(import.meta.url));
  return join(testDir, '..', '..', 'src', 'tests', 'fixtures', name);
}

test('worker pid and log files live under runtime state dir', async () => {
  await withStateDir(async (stateDir) => {
    const paths = getStatePaths();

    assert.match(paths.runtimePidPath, /runtime\/worker\.pid$/);
    assert.match(paths.runtimeLogPath, /runtime\/worker\.log$/);
    assert.match(paths.runtimePidPath, new RegExp(stateDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(paths.runtimeLogPath, new RegExp(stateDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
});

test('doctor guidance prioritizes worker checks before advanced mode', () => {
  const guidance = buildDoctorGuidance().join('\n');

  assert.match(guidance, /Worker 联调建议/);
  assert.match(guidance, /node dist\/cli\.js start/);
  assert.match(guidance, /高级模式（可选）/);
});

test('resolveClaudeCommand prefers explicit CLAUDE_BIN when provided', () => {
  const command = resolveClaudeCommand({
    CLAUDE_BIN: process.execPath,
    PATH: ''
  });

  assert.equal(command, process.execPath);
});

test('claude code runner can execute fake success fixture', async () => {
  await withStateDir(async () => {
    const runner = new ClaudeCodeRunner({
      command: process.execPath,
      args: [fixturePath('fake-claude-success.mjs')]
    });

    const run = runner.start({
      conversationId: 'conv-success',
      workspaceRoot: process.cwd(),
      approvalPolicy: 'sensitive_confirmation',
      taskText: '修复登录 bug'
    });

    const result = await run.completion;
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /已完成：修改 src\/example\.ts 并通过验证/);
  });
});

test('claude code runner can execute fake failure fixture', async () => {
  await withStateDir(async () => {
    const runner = new ClaudeCodeRunner({
      command: process.execPath,
      args: [fixturePath('fake-claude-fail.mjs')]
    });

    const run = runner.start({
      conversationId: 'conv-fail',
      workspaceRoot: process.cwd(),
      approvalPolicy: 'sensitive_confirmation',
      taskText: '运行失败任务'
    });

    const result = await run.completion;
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /permission denied/);
  });
});

test('claude code runner resumes an existing conversation session', async () => {
  await withStateDir(async () => {
    const runner = new ClaudeCodeRunner({
      command: process.execPath,
      args: [fixturePath('fake-claude-args.mjs')]
    });

    const firstRun = runner.start({
      conversationId: 'conv-existing',
      workspaceRoot: process.cwd(),
      approvalPolicy: 'sensitive_confirmation',
      taskText: '第一次任务'
    });
    const firstResult = await firstRun.completion;
    const firstArgs = JSON.parse(firstResult.stdout) as string[];
    const firstSessionFlagIndex = firstArgs.indexOf('--session-id');

    assert.equal(firstResult.exitCode, 0);
    assert.ok(firstSessionFlagIndex >= 0);

    const sessionId = firstArgs[firstSessionFlagIndex + 1];
    assert.ok(sessionId);

    const secondRun = runner.start({
      conversationId: 'conv-existing',
      workspaceRoot: process.cwd(),
      approvalPolicy: 'sensitive_confirmation',
      taskText: '继续之前的任务'
    });

    const result = await secondRun.completion;
    const args = JSON.parse(result.stdout) as string[];

    assert.equal(result.exitCode, 0);
    assert.deepEqual(args.slice(0, 4), ['-p', args[1]!, '--resume', sessionId]);
    assert.equal(args.includes('--session-id'), false);
    assert.equal(args.includes('--strict-mcp-config'), true);
    const mcpConfigIndex = args.indexOf('--mcp-config');
    assert.ok(mcpConfigIndex >= 0);
    assert.equal(args[mcpConfigIndex + 1], '{"mcpServers":{}}');
  });
});

test('claude code runner adds attachment directories and prompt paths', async () => {
  await withStateDir(async () => {
    const runner = new ClaudeCodeRunner({
      command: process.execPath,
      args: [fixturePath('fake-claude-args.mjs')]
    });

    const run = runner.start({
      conversationId: 'conv-image',
      workspaceRoot: process.cwd(),
      approvalPolicy: 'sensitive_confirmation',
      taskText: '请结合图片说明问题',
      attachments: [{
        type: 'image',
        source: 'image-link',
        filePath: '/tmp/wechat-agent-media/demo.png',
        mimeType: 'image/png',
        originalUrl: 'https://example.com/demo.png'
      }]
    });

    const result = await run.completion;
    const args = JSON.parse(result.stdout) as string[];

    assert.equal(result.exitCode, 0);
    assert.ok(args.includes('/tmp/wechat-agent-media'));
    assert.match(args[1] ?? '', /\/tmp\/wechat-agent-media\/demo\.png/);
  });
});
