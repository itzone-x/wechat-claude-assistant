import { execFile } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getStatePaths } from './config.js';
import { deleteFile, ensureParentDir, fileExists, writeTextFile } from './state.js';
import type { InstallConfig } from '../types/install.js';

const execFileAsync = promisify(execFile);

export const SERVICE_LABEL = 'com.wechat-agent.claude-code';

export interface LaunchdOptions {
  launchAgentsDir?: string;
  writeOnly?: boolean;
}

export interface LaunchdStatus {
  supported: boolean;
  installed: boolean;
  loaded: boolean;
  launchAgentPath: string;
  label: string;
}

function plistEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function currentCliPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', 'cli.js');
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveClaudeBin(): string | null {
  const explicit = process.env.CLAUDE_BIN?.trim();
  if (explicit && isExecutable(explicit)) {
    return explicit;
  }

  const candidates = [
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude'
  ];

  for (const candidate of candidates) {
    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function getLaunchAgentsDir(override?: string): string {
  return override?.trim()
    || process.env.WECHAT_AGENT_LAUNCH_AGENTS_DIR?.trim()
    || join(homedir(), 'Library', 'LaunchAgents');
}

export function getLaunchAgentPath(overrideDir?: string): string {
  return join(getLaunchAgentsDir(overrideDir), `${SERVICE_LABEL}.plist`);
}

export function isLaunchdSupported(): boolean {
  return process.platform === 'darwin';
}

function currentUserId(): number {
  if (typeof process.getuid !== 'function') {
    throw new Error('当前环境不支持读取 macOS 用户 ID。');
  }
  return process.getuid();
}

export function buildLaunchdPlist(config: InstallConfig): string {
  const paths = getStatePaths();
  const programArguments = [
    process.execPath,
    currentCliPath(),
    'start',
    '--foreground'
  ];

  const envVars: Record<string, string> = {};
  if (process.env.PATH?.trim()) {
    envVars.PATH = process.env.PATH.trim();
  }
  if (process.env.WECHAT_AGENT_STATE_DIR?.trim()) {
    envVars.WECHAT_AGENT_STATE_DIR = process.env.WECHAT_AGENT_STATE_DIR.trim();
  }
  const claudeBin = resolveClaudeBin();
  if (claudeBin) {
    envVars.CLAUDE_BIN = claudeBin;
  }

  const envBlock = Object.keys(envVars).length === 0
    ? ''
    : [
      '  <key>EnvironmentVariables</key>',
      '  <dict>',
      ...Object.entries(envVars).flatMap(([key, value]) => [
        `    <key>${plistEscape(key)}</key>`,
        `    <string>${plistEscape(value)}</string>`
      ]),
      '  </dict>'
    ].join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    `  <key>Label</key>`,
    `  <string>${SERVICE_LABEL}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    ...programArguments.map((arg) => `    <string>${plistEscape(arg)}</string>`),
    '  </array>',
    '  <key>WorkingDirectory</key>',
    `  <string>${plistEscape(config.workspaceRoot)}</string>`,
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '  <key>KeepAlive</key>',
    '  <true/>',
    '  <key>StandardOutPath</key>',
    `  <string>${plistEscape(paths.runtimeLogPath)}</string>`,
    '  <key>StandardErrorPath</key>',
    `  <string>${plistEscape(paths.runtimeLogPath)}</string>`,
    envBlock,
    '</dict>',
    '</plist>',
    ''
  ].filter(Boolean).join('\n');
}

async function launchctl(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('launchctl', args, {
    encoding: 'utf-8'
  });
  return stdout.trim();
}

export async function installLaunchdService(
  config: InstallConfig,
  options: LaunchdOptions = {}
): Promise<string> {
  if (!isLaunchdSupported()) {
    throw new Error('当前系统不是 macOS，暂不支持 launchd 自动启动。');
  }

  const launchAgentPath = getLaunchAgentPath(options.launchAgentsDir);
  const plist = buildLaunchdPlist(config);
  await ensureParentDir(launchAgentPath);
  await writeTextFile(launchAgentPath, plist);

  if (!options.writeOnly) {
    const domainTarget = `gui/${currentUserId()}/${SERVICE_LABEL}`;
    await launchctl(['bootout', domainTarget]).catch(() => undefined);
    await launchctl(['bootstrap', `gui/${currentUserId()}`, launchAgentPath]);
    await launchctl(['enable', domainTarget]).catch(() => undefined);
    await launchctl(['kickstart', '-k', domainTarget]).catch(() => undefined);
  }

  return launchAgentPath;
}

export async function uninstallLaunchdService(
  options: LaunchdOptions = {}
): Promise<string> {
  if (!isLaunchdSupported()) {
    throw new Error('当前系统不是 macOS，暂不支持 launchd 自动启动。');
  }

  const launchAgentPath = getLaunchAgentPath(options.launchAgentsDir);
  if (!options.writeOnly) {
    const domainTarget = `gui/${currentUserId()}/${SERVICE_LABEL}`;
    await launchctl(['bootout', domainTarget]).catch(() => undefined);
  }
  await deleteFile(launchAgentPath);
  return launchAgentPath;
}

export async function stopLaunchdService(
  options: LaunchdOptions = {}
): Promise<void> {
  if (!isLaunchdSupported()) {
    throw new Error('当前系统不是 macOS，暂不支持 launchd 自动启动。');
  }

  if (options.writeOnly) {
    return;
  }

  const domainTarget = `gui/${currentUserId()}/${SERVICE_LABEL}`;
  await launchctl(['bootout', domainTarget]).catch(() => undefined);
}

export async function getLaunchdStatus(
  options: LaunchdOptions = {}
): Promise<LaunchdStatus> {
  const launchAgentPath = getLaunchAgentPath(options.launchAgentsDir);

  if (!isLaunchdSupported()) {
    return {
      supported: false,
      installed: false,
      loaded: false,
      launchAgentPath,
      label: SERVICE_LABEL
    };
  }

  const installed = await fileExists(launchAgentPath);
  let loaded = false;

  if (installed && !options.writeOnly) {
    try {
      await launchctl(['print', `gui/${currentUserId()}/${SERVICE_LABEL}`]);
      loaded = true;
    } catch {
      loaded = false;
    }
  }

  return {
    supported: true,
    installed,
    loaded,
    launchAgentPath,
    label: SERVICE_LABEL
  };
}
