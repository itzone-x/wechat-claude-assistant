import { resolve } from 'node:path';

import { CHANNEL_REPLY_TOOL_NAME, LEGACY_CHANNEL_MESSAGE_TOOL_NAME, LEGACY_CHANNEL_REPLY_TOOL_NAME } from './channels-validation.js';
import { readJsonFile, writeJsonFile } from './state.js';

interface McpConfigShape {
  mcpServers?: Record<string, unknown>;
}

interface SettingsShape {
  permissions?: {
    allow?: string[];
  };
  [key: string]: unknown;
}

export function buildChannelsMcpEntry(projectRoot = process.cwd()) {
  return {
    command: 'node',
    args: [resolve(projectRoot, 'dist/cli.js'), 'start', '--mode', 'channels']
  };
}

export function mergeChannelsMcpConfig(
  existing: McpConfigShape | null | undefined,
  projectRoot = process.cwd()
): McpConfigShape {
  return {
    ...(existing || {}),
    mcpServers: {
      ...((existing && existing.mcpServers) || {}),
      wechat: buildChannelsMcpEntry(projectRoot)
    }
  };
}

export function mergeChannelsSettings(
  existing: SettingsShape | null | undefined
): SettingsShape {
  const allowList = [
    ...new Set(
      ((existing?.permissions?.allow || []).filter((item) => (
        item !== LEGACY_CHANNEL_MESSAGE_TOOL_NAME
        && item !== LEGACY_CHANNEL_REPLY_TOOL_NAME
      ))).concat(CHANNEL_REPLY_TOOL_NAME)
    )
  ];

  return {
    ...(existing || {}),
    permissions: {
      ...((existing && existing.permissions) || {}),
      allow: allowList
    }
  };
}

export async function syncChannelsLocalConfig(projectRoot = process.cwd()): Promise<{
  mcpPath: string;
  settingsPath: string;
}> {
  const mcpPath = resolve(projectRoot, '.mcp.json');
  const settingsPath = resolve(projectRoot, '.claude', 'settings.local.json');

  const currentMcp = await readJsonFile<McpConfigShape>(mcpPath, {});
  const currentSettings = await readJsonFile<SettingsShape>(settingsPath, {});

  await writeJsonFile(mcpPath, mergeChannelsMcpConfig(currentMcp, projectRoot));
  await writeJsonFile(settingsPath, mergeChannelsSettings(currentSettings));

  return {
    mcpPath,
    settingsPath
  };
}
