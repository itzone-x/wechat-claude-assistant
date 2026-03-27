import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { getDefaultInstallConfig } from '../core/config.js';
import { buildInstallNextSteps } from '../commands/install.js';
import { getModeChoices } from '../ui/wizard.js';

test('default install config prefers worker mode', () => {
  const config = getDefaultInstallConfig('/tmp/project');

  assert.equal(config.mode, 'worker');
});

test('wizard presents worker as the recommended mode', () => {
  const choices = getModeChoices();

  assert.equal(choices[0]?.value, 'worker');
  assert.match(choices[0]?.label ?? '', /推荐/);
  assert.match(choices[0]?.description ?? '', /微信派活/);
  assert.equal(choices[1]?.value, 'channels');
  assert.match(choices[1]?.label ?? '', /高级模式/);
});

test('cli help keeps channels in the advanced section', () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const cliPath = join(testDir, '..', 'cli.js');
  const result = spawnSync(process.execPath, [cliPath, 'help'], {
    encoding: 'utf-8'
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /安装向导（默认走微信派活模式）/);
  assert.match(result.stdout, /启动微信派活 worker（推荐）/);
  assert.match(result.stdout, /doctor --channels/);
  assert.match(result.stdout, /channels \.\.\. 高级模式配置/);
});

test('install next steps prefer service verification when auto-start is loaded', () => {
  const config = getDefaultInstallConfig('/tmp/project');
  config.preferredAutoStart = true;

  const lines = buildInstallNextSteps(config, {
    autoStartAttempted: true,
    autoStartLoaded: true
  });

  assert.match(lines.join('\n'), /自动启动服务已安装并加载/);
  assert.match(lines.join('\n'), /service status/);
  assert.match(lines.join('\n'), /worker 运行中: 是/);
  assert.match(lines.join('\n'), /\/echo 你好/);
});

test('install next steps shorten when auto-start is loaded and worker is already running', () => {
  const config = getDefaultInstallConfig('/tmp/project');
  config.preferredAutoStart = true;

  const lines = buildInstallNextSteps(config, {
    autoStartAttempted: true,
    autoStartLoaded: true,
    workerRunning: true,
    workerPid: 12345
  });

  assert.match(lines.join('\n'), /worker 已在运行/);
  assert.match(lines.join('\n'), /\/echo 你好/);
  assert.doesNotMatch(lines.join('\n'), /service status/);
});

test('install next steps fall back to manual start when auto-start is not loaded', () => {
  const config = getDefaultInstallConfig('/tmp/project');
  config.preferredAutoStart = true;

  const lines = buildInstallNextSteps(config, {
    autoStartAttempted: true,
    autoStartLoaded: false
  });

  assert.match(lines.join('\n'), /自动启动服务尚未成功加载/);
  assert.match(lines.join('\n'), /service install/);
  assert.match(lines.join('\n'), /start --daemon/);
});
