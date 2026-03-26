import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadRuntimeStatus, markRuntimeStarted, markRuntimeStopped } from '../runtime/progress.js';

async function withStateDir<T>(fn: (stateDir: string) => Promise<T>): Promise<T> {
  const previous = process.env.WECHAT_AGENT_STATE_DIR;
  const stateDir = await mkdtemp(join(tmpdir(), 'wechat-agent-progress-test-'));
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

test('markRuntimeStopped ignores stale pid from an older worker', async () => {
  await withStateDir(async () => {
    await markRuntimeStarted({
      mode: 'worker',
      daemon: true,
      workspaceRoot: '/tmp/project',
      pid: 22222
    });

    await markRuntimeStopped(11111);

    const snapshot = await loadRuntimeStatus();
    assert.equal(snapshot.running, true);
    assert.equal(snapshot.pid, 22222);
  });
});
