import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { getStatePaths } from '../core/config.js';
import { writeJsonFile, writeTextFile } from '../core/state.js';
import { waitForDaemonReady } from '../commands/start.js';

async function withStateDir<T>(fn: (stateDir: string) => Promise<T>): Promise<T> {
  const previous = process.env.WECHAT_AGENT_STATE_DIR;
  const stateDir = await mkdtemp(join(tmpdir(), 'wechat-agent-start-test-'));
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

test('waitForDaemonReady resolves once runtime status reports a live pid', async () => {
  await withStateDir(async () => {
    const paths = getStatePaths();

    const waiting = waitForDaemonReady(process.pid, 1000);
    setTimeout(async () => {
      await writeJsonFile(paths.runtimeStatusPath, {
        running: true,
        updatedAt: new Date().toISOString(),
        pid: process.pid,
        conversations: {}
      });
    }, 100);

    await waiting;
  });
});

test('waitForDaemonReady surfaces daemon log when boot process exits early', async () => {
  await withStateDir(async () => {
    const paths = getStatePaths();
    await writeTextFile(paths.runtimeLogPath, [
      '正在启动微信派活 worker。',
      '尚未连接微信，请先运行 install 或 login。'
    ].join('\n'));

    await assert.rejects(
      waitForDaemonReady(999999, 200),
      /尚未连接微信，请先运行 install 或 login/
    );
  });
});
