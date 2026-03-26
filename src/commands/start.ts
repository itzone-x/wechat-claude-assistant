import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getDefaultInstallConfig, getStatePaths } from '../core/config.js';
import { loadSavedAccount } from '../core/login-qr.js';
import { ensureParentDir, readJsonFile, readTextFile } from '../core/state.js';
import type { InstallConfig, RuntimeMode } from '../types/install.js';
import type { RuntimeStatusSnapshot } from '../types/agent.js';
import { startWorkerRuntime } from '../runtime/worker.js';
import { startChannelServer } from '../adapters/channels/server.js';
import { validateWorkerConfig } from '../runtime/policy.js';

function readModeArg(args: string[]): RuntimeMode | undefined {
  const modeIndex = args.findIndex((arg) => arg === '--mode');
  if (modeIndex === -1) {
    return undefined;
  }

  const candidate = args[modeIndex + 1];
  return candidate === 'worker' || candidate === 'channels'
    ? candidate
    : undefined;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      return true;
    }
    return false;
  }
}

function defaultRuntimeStatus(): RuntimeStatusSnapshot {
  return {
    running: false,
    updatedAt: new Date(0).toISOString(),
    conversations: {}
  };
}

function tailText(text: string, maxLines = 20): string {
  return text
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-maxLines)
    .join('\n');
}

export async function waitForDaemonReady(
  bootPid: number,
  timeoutMs = 5000
): Promise<void> {
  const paths = getStatePaths();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const snapshot = await readJsonFile<RuntimeStatusSnapshot>(
      paths.runtimeStatusPath,
      defaultRuntimeStatus()
    );
    if (
      snapshot.running
      && typeof snapshot.pid === 'number'
      && snapshot.pid > 0
      && isProcessAlive(snapshot.pid)
    ) {
      return;
    }

    if (!isProcessAlive(bootPid)) {
      const log = tailText(await readTextFile(paths.runtimeLogPath, ''));
      throw new Error(
        log
          ? `后台 worker 启动失败：\n${log}`
          : '后台 worker 启动失败：子进程已退出，且没有留下可读日志。'
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  const log = tailText(await readTextFile(paths.runtimeLogPath, ''));
  throw new Error(
    log
      ? `后台 worker 启动超时：\n${log}`
      : '后台 worker 启动超时：在预期时间内没有进入可运行状态。'
  );
}

async function startDaemon(mode: RuntimeMode): Promise<void> {
  const paths = getStatePaths();
  const existingPid = Number.parseInt((await readTextFile(paths.runtimePidPath, '')).trim(), 10);
  if (Number.isFinite(existingPid) && existingPid > 0 && isProcessAlive(existingPid)) {
    console.log(`后台进程已在运行，PID: ${existingPid}`);
    return;
  }

  await ensureParentDir(paths.runtimeLogPath);
  const logFd = openSync(paths.runtimeLogPath, 'a');
  const cliPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'cli.js');
  const child = spawn(
    process.execPath,
    [cliPath, 'start', '--foreground', '--mode', mode],
    {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: {
        ...process.env,
        WECHAT_AGENT_DAEMON_CHILD: '1'
      }
    }
  );

  closeSync(logFd);
  child.unref();
  await waitForDaemonReady(child.pid ?? -1);

  console.log('已启动后台模式。');
  console.log(`PID: ${child.pid}`);
  console.log(`日志文件: ${paths.runtimeLogPath}`);
}

export async function runStartCommand(args: string[]): Promise<void> {
  const account = await loadSavedAccount();
  if (!account) {
    throw new Error('尚未连接微信，请先运行 install 或 login。');
  }

  const config = await readJsonFile<InstallConfig>(
    getStatePaths().installConfigPath,
    getDefaultInstallConfig()
  );
  const mode = readModeArg(args) || config.mode;
  const daemon = hasFlag(args, '--daemon');
  const foreground = hasFlag(args, '--foreground');

  if (mode === 'channels') {
    if (daemon) {
      throw new Error('channels 模式不支持后台启动，请直接在前台运行。');
    }
    console.error('正在启动高级模式：微信消息会桥接到当前 Claude Code 会话。');
    await startChannelServer();
    return;
  }

  const workerConfig = await validateWorkerConfig({
    ...config,
    mode
  });

  if (daemon && !foreground) {
    await startDaemon(mode);
    return;
  }

  console.log('正在启动微信派活 worker。');
  await startWorkerRuntime(workerConfig);
}
