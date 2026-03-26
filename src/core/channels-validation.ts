export const CHANNEL_SERVER_NAME = 'wechat';
export const CHANNEL_REPLY_TOOL_NAME = `mcp__${CHANNEL_SERVER_NAME}__wechat_reply`;
export const LEGACY_CHANNEL_MESSAGE_TOOL_NAME = 'mcp__wechat-and-claude-code-holding-hands__wechat_get_messages';
export const LEGACY_CHANNEL_REPLY_TOOL_NAME = 'mcp__wechat-and-claude-code-holding-hands__wechat_reply';

export interface ChannelsSettingsAnalysis {
  status: 'ok' | 'warn';
  detail: string;
}

interface SettingsShape {
  permissions?: {
    allow?: string[];
  };
}

function parseSettings(raw: string): SettingsShape | null {
  try {
    return JSON.parse(raw) as SettingsShape;
  } catch {
    return null;
  }
}

export function analyzeChannelsSettings(raw: string): ChannelsSettingsAnalysis {
  const parsed = parseSettings(raw);
  if (!parsed) {
    return {
      status: 'warn',
      detail: '`.claude/settings.local.json` 不是有效 JSON，无法验证 channels 权限白名单。'
    };
  }

  const allowList = parsed.permissions?.allow || [];
  if (allowList.includes(CHANNEL_REPLY_TOOL_NAME)) {
    return {
      status: 'ok',
      detail: `已允许当前 channels 回复工具: ${CHANNEL_REPLY_TOOL_NAME}`
    };
  }

  if (
    allowList.includes(LEGACY_CHANNEL_MESSAGE_TOOL_NAME)
    || allowList.includes(LEGACY_CHANNEL_REPLY_TOOL_NAME)
  ) {
    return {
      status: 'warn',
      detail: '检测到旧的 channels 工具白名单，建议改成只允许 `mcp__wechat__wechat_reply`。'
    };
  }

  return {
    status: 'warn',
    detail: '还没有为当前 channels 回复工具配置本地 allowlist。'
  };
}

export function expectedChannelsFilesStatus(hasPluginManifest: boolean, hasPluginMcp: boolean): ChannelsSettingsAnalysis {
  if (hasPluginManifest && hasPluginMcp) {
    return {
      status: 'ok',
      detail: '检测到 `.claude-plugin/plugin.json` 和 `plugin.mcp.json`。'
    };
  }

  if (hasPluginManifest || hasPluginMcp) {
    return {
      status: 'warn',
      detail: 'channels 包装文件不完整，`.claude-plugin/plugin.json` 与 `plugin.mcp.json` 应同时存在。'
    };
  }

  return {
    status: 'warn',
    detail: '当前仓库还没有完整的 channels 插件包装文件。'
  };
}
