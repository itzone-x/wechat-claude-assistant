import { homedir } from 'node:os';
import { join } from 'node:path';

import type { InstallConfig } from '../types/install.js';

export const APP_NAME = '微信 Claude Code 助手';
export const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com';
export const DEFAULT_CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c';
export const DEFAULT_BOT_TYPE = '3';
export const DEFAULT_CHANNEL_VERSION = '0.2.0';

export interface StatePaths {
  stateDir: string;
  runtimeDir: string;
  attachmentsDir: string;
  accountPath: string;
  legacyAccountPath: string;
  installConfigPath: string;
  pairingPath: string;
  conversationStorePath: string;
  messageDedupPath: string;
  runtimeStatusPath: string;
  runtimePidPath: string;
  runtimeLogPath: string;
}

export function getStatePaths(): StatePaths {
  const stateDir = process.env.WECHAT_AGENT_STATE_DIR?.trim()
    || join(homedir(), '.claude', 'wechat-agent');
  const runtimeDir = join(stateDir, 'runtime');

  return {
    stateDir,
    runtimeDir,
    attachmentsDir: join(runtimeDir, 'attachments'),
    accountPath: join(stateDir, 'account.json'),
    legacyAccountPath: join(homedir(), '.claude', 'channels', 'wechat', 'account.json'),
    installConfigPath: join(stateDir, 'install-config.json'),
    pairingPath: join(stateDir, 'pairing.json'),
    conversationStorePath: join(stateDir, 'conversations.json'),
    messageDedupPath: join(runtimeDir, 'message-dedup.json'),
    runtimeStatusPath: join(runtimeDir, 'status.json'),
    runtimePidPath: join(runtimeDir, 'worker.pid'),
    runtimeLogPath: join(runtimeDir, 'worker.log')
  };
}

export function getDefaultInstallConfig(
  workspaceRoot: string = process.cwd()
): InstallConfig {
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
