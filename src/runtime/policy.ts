import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { ApprovalPolicy, InstallConfig } from '../types/install.js';

export function permissionModeFor(policy: ApprovalPolicy): string {
  switch (policy) {
    case 'auto_low_risk':
      return 'acceptEdits';
    case 'fully_manual':
      return 'plan';
    default:
      return 'default';
  }
}

export async function validateWorkerConfig(
  config: InstallConfig
): Promise<InstallConfig> {
  const workspaceRoot = resolve(config.workspaceRoot);
  const workspaceStat = await stat(workspaceRoot).catch(() => null);

  if (!workspaceStat?.isDirectory()) {
    throw new Error(`工作目录不存在或不可用: ${workspaceRoot}`);
  }

  return {
    ...config,
    workspaceRoot
  };
}
