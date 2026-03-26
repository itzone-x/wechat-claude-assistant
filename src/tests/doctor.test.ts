import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { checkStateDirectory } from '../commands/doctor.js';

test('checkStateDirectory reports existing writable directory as ok', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'wechat-agent-doctor-'));

  const result = await checkStateDirectory(stateDir);

  assert.equal(result.status, 'ok');
  assert.match(result.detail, /可读写/);
});

test('checkStateDirectory reports missing directory with writable parent as warn', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wechat-agent-doctor-'));
  const parent = join(root, 'nested');
  const stateDir = join(parent, 'state');
  await mkdir(parent, { recursive: true });

  const result = await checkStateDirectory(stateDir);

  assert.equal(result.status, 'warn');
  assert.match(result.detail, /首次运行时可创建/);
});
