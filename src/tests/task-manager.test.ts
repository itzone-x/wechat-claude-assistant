import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { InstallConfig } from '../types/install.js';
import { TaskManager } from '../runtime/task-manager.js';
import type { AgentRunner, RunningAgentRun, WorkerRunRequest, WorkerRunResult } from '../runtime/agent-runner.js';
import { buildClaudeWorkerPrompt } from '../runtime/claude-code-runner.js';
import { parseWorkerCommand } from '../runtime/worker-commands.js';
import type { WorkerAttachment } from '../types/ilink.js';

class FakeRunner implements AgentRunner {
  public readonly requests: WorkerRunRequest[] = [];

  constructor(private readonly result: WorkerRunResult) {}

  start(request: WorkerRunRequest): RunningAgentRun {
    this.requests.push(request);
    return {
      completion: Promise.resolve(this.result),
      cancel: () => {}
    };
  }
}

class DeferredRunner implements AgentRunner {
  public readonly requests: WorkerRunRequest[] = [];
  private resolveRun: ((result: WorkerRunResult) => void) | null = null;

  start(request: WorkerRunRequest): RunningAgentRun {
    this.requests.push(request);
    const completion = new Promise<WorkerRunResult>((resolve) => {
      this.resolveRun = resolve;
    });

    return {
      completion,
      cancel: () => {
        this.resolve({
          exitCode: 1,
          stdout: '',
          stderr: 'cancelled'
        });
      }
    };
  }

  resolve(result: WorkerRunResult): void {
    this.resolveRun?.(result);
    this.resolveRun = null;
  }
}

function createConfig(workspaceRoot: string): InstallConfig {
  const now = new Date().toISOString();
  return {
    mode: 'worker',
    workspacePolicy: 'current_project',
    workspaceRoot,
    approvalPolicy: 'sensitive_confirmation',
    preferredAutoStart: false,
    installedAt: now,
    updatedAt: now
  };
}

async function withStateDir<T>(fn: (stateDir: string) => Promise<T>): Promise<T> {
  const previous = process.env.WECHAT_AGENT_STATE_DIR;
  const stateDir = await mkdtemp(join(tmpdir(), 'wechat-agent-task-manager-'));
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

async function waitFor(condition: () => boolean, timeoutMs = 1000): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('waitFor timeout');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function waitForReplyMatch(
  replies: string[],
  pattern: RegExp,
  timeoutMs = 1000
): Promise<void> {
  await waitFor(() => replies.some((reply) => pattern.test(reply)), timeoutMs);
}

test('worker prompt includes workspace constraint and chinese summary requirement', () => {
  const prompt = buildClaudeWorkerPrompt({
    workspaceRoot: '/tmp/project',
    taskText: '修复登录 bug'
  });

  assert.match(prompt, /工作目录 \/tmp\/project/);
  assert.match(prompt, /请用中文简短总结/);
  assert.match(prompt, /不要调用任何 MCP、插件或微信回复工具/);
  assert.match(prompt, /修复登录 bug/);
});

test('worker prompt includes image attachment paths when provided', () => {
  const prompt = buildClaudeWorkerPrompt({
    workspaceRoot: '/tmp/project',
    taskText: '请结合图片回答',
    attachments: [{
      type: 'image',
      source: 'wechat-upload',
      filePath: '/tmp/input/demo.png',
      mimeType: 'image/png'
    }]
  });

  assert.match(prompt, /本次任务还附带图片输入/);
  assert.match(prompt, /\/tmp\/input\/demo\.png/);
  assert.match(prompt, /请结合图片回答/);
});

test('worker prompt includes audio attachment paths when provided', () => {
  const prompt = buildClaudeWorkerPrompt({
    workspaceRoot: '/tmp/project',
    taskText: '请根据语音内容回答',
    attachments: [{
      type: 'audio',
      source: 'wechat-upload',
      filePath: '/tmp/input/demo.wav',
      mimeType: 'audio/wav'
    }]
  });

  assert.match(prompt, /本次任务还附带语音输入/);
  assert.match(prompt, /\/tmp\/input\/demo\.wav/);
  assert.match(prompt, /请根据语音内容回答/);
});

test('worker prompt includes document and webpage attachment hints when provided', () => {
  const prompt = buildClaudeWorkerPrompt({
    workspaceRoot: '/tmp/project',
    taskText: '请结合文章和附件总结',
    attachments: [
      {
        type: 'webpage',
        source: 'url-link',
        filePath: '/tmp/input/article-preview.md',
        title: '公众号文章标题',
        originalUrl: 'https://example.com/article'
      },
      {
        type: 'document',
        source: 'wechat-upload',
        filePath: '/tmp/input/report-preview.md',
        originalFilePath: '/tmp/input/report.pdf',
        fileName: 'report.pdf'
      }
    ]
  });

  assert.match(prompt, /网页内容（1 个）/);
  assert.match(prompt, /文档输入（1 个）/);
  assert.match(prompt, /article-preview\.md/);
  assert.match(prompt, /report-preview\.md/);
  assert.match(prompt, /原始附件: \/tmp\/input\/report\.pdf/);
  assert.match(prompt, /标题: 公众号文章标题/);
});

test('parseWorkerCommand recognizes reset', () => {
  assert.deepEqual(parseWorkerCommand('/reset'), { type: 'reset' });
  assert.deepEqual(parseWorkerCommand('/echo 你好'), { type: 'echo', text: '你好' });
});

test('task manager reports successful worker execution without spawning claude', async () => {
  await withStateDir(async () => {
    const replies: Array<{ text: string; toUserId?: string; contextToken?: string }> = [];
    const runner = new FakeRunner({
      exitCode: 0,
      stdout: '已完成：修改 src/example.ts 并通过验证',
      stderr: ''
    });
    const manager = new TaskManager(
      createConfig(process.cwd()),
      async (text, toUserId, contextToken) => {
        replies.push({ text, toUserId, contextToken });
      },
      runner,
      5_000
    );

    await manager.handleMessage({
      fromUserId: 'user-123',
      text: '修复登录 bug',
      contextToken: 'ctx-456'
    });
    await waitFor(() => replies.length >= 1 && !manager.hasActiveTask('user-123'));

    assert.equal(runner.requests.length, 1);
    assert.equal(runner.requests[0]?.conversationId, 'user-123');
    assert.equal(runner.requests[0]?.taskText, '修复登录 bug');
    assert.equal(replies.length, 1);
    assert.equal(replies[0]?.text ?? '', '已完成：修改 src/example.ts 并通过验证');
    assert.equal(manager.hasActiveTask('user-123'), false);
  });
});

test('task manager accepts image-only messages and forwards attachments to runner', async () => {
  await withStateDir(async () => {
    const replies: string[] = [];
    const runner = new FakeRunner({
      exitCode: 0,
      stdout: '已完成：识别图片内容并给出说明',
      stderr: ''
    });
    const manager = new TaskManager(
      createConfig(process.cwd()),
      async (text) => {
        replies.push(text);
      },
      runner,
      5_000
    );

    const attachments: WorkerAttachment[] = [{
      type: 'image',
      source: 'wechat-upload',
      filePath: '/tmp/wechat-agent-media/demo.png',
      mimeType: 'image/png'
    }];

    await manager.handleMessage({
      fromUserId: 'user-image',
      text: '',
      contextToken: 'ctx-image',
      attachments
    });
    await waitFor(() => replies.length >= 1 && !manager.hasActiveTask('user-image'));

    assert.equal(runner.requests.length, 1);
    assert.deepEqual(runner.requests[0]?.attachments, attachments);
    assert.equal(replies.length, 1);
    assert.equal(replies[0] ?? '', '已完成：识别图片内容并给出说明');
  });
});

test('task manager reports worker failures without spawning claude', async () => {
  await withStateDir(async () => {
    const replies: string[] = [];
    const runner = new FakeRunner({
      exitCode: 1,
      stdout: '',
      stderr: 'permission denied'
    });
    const manager = new TaskManager(
      createConfig(process.cwd()),
      async (text) => {
        replies.push(text);
      },
      runner,
      5_000
    );

    await manager.handleMessage({
      fromUserId: 'user-123',
      text: '运行一个失败任务',
      contextToken: 'ctx-456'
    });
    await waitFor(() => replies.length >= 1 && !manager.hasActiveTask('user-123'));

    assert.equal(replies.length, 1);
    assert.match(replies[0] ?? '', /任务执行失败/);
    assert.match(replies[0] ?? '', /permission denied/);
    assert.equal(manager.hasActiveTask('user-123'), false);
  });
});

test('task manager rejects a new task while one is active', async () => {
  await withStateDir(async () => {
    const replies: string[] = [];
    const runner = new DeferredRunner();
    const manager = new TaskManager(
      createConfig(process.cwd()),
      async (text) => {
        replies.push(text);
      },
      runner,
      5_000
    );

    await manager.handleMessage({
      fromUserId: 'user-123',
      text: '先跑一个长任务',
      contextToken: 'ctx-1'
    });
    await waitFor(() => manager.hasActiveTask('user-123'));
    await waitFor(() => runner.requests.length === 1);

    await manager.handleMessage({
      fromUserId: 'user-123',
      text: '再发一个任务',
      contextToken: 'ctx-2'
    });

    await waitForReplyMatch(replies, /当前已有任务在运行/);
    assert.ok(replies.some((reply) => /当前已有任务在运行/.test(reply)));
    assert.equal(manager.hasActiveTask('user-123'), true);

    runner.resolve({
      exitCode: 0,
      stdout: '已完成',
      stderr: ''
    });
    await waitFor(() => manager.hasActiveTask('user-123') === false);
    await waitForReplyMatch(replies, /任务完成/);

    assert.equal(manager.hasActiveTask('user-123'), false);
  });
});

test('task manager sends a short progress hint only after long-running delay', async () => {
  await withStateDir(async () => {
    const replies: string[] = [];
    const runner = new DeferredRunner();
    const manager = new TaskManager(
      createConfig(process.cwd()),
      async (text) => {
        replies.push(text);
      },
      runner,
      50
    );

    await manager.handleMessage({
      fromUserId: 'user-slow',
      text: '做一个稍慢的任务',
      contextToken: 'ctx-slow'
    });

    await waitForReplyMatch(replies, /处理中，发送 \/status 可查看进展/);

    runner.resolve({
      exitCode: 0,
      stdout: '慢任务完成',
      stderr: ''
    });

    await waitForReplyMatch(replies, /^慢任务完成$/);
    assert.ok(replies.some((reply) => /处理中，发送 \/status 可查看进展/.test(reply)));
    assert.ok(replies.some((reply) => reply === '慢任务完成'));
  });
});
