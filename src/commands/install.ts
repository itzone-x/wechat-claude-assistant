import { runInstallWizard } from '../ui/wizard.js';
import type { InstallConfig } from '../types/install.js';
import {
  getLaunchdStatus,
  installLaunchdService,
  isLaunchdSupported
} from '../core/launchd.js';
import { syncChannelsLocalConfig } from '../core/channels-config.js';

export interface InstallCompletionState {
  autoStartAttempted?: boolean;
  autoStartLoaded?: boolean;
  autoStartError?: string | null;
}

export function buildInstallNextSteps(
  config: InstallConfig,
  state: InstallCompletionState = {}
): string[] {
  if (config.mode === 'channels') {
    return [
      '1. 如有需要，运行 `node dist/cli.js channels setup` 重新同步高级模式配置',
      '2. 仅在你已经满足 Claude Channels 使用条件时，运行 `node dist/cli.js start --mode channels`'
    ];
  }

  if (config.preferredAutoStart && isLaunchdSupported()) {
    if (state.autoStartLoaded) {
      return [
        '1. 自动启动服务已安装并加载。',
        '2. 运行 `node dist/cli.js service status` 和 `node dist/cli.js status` 确认状态。',
        '3. 看到“已加载: 是”和“worker 运行中: 是”后，在微信里发送 `/echo 你好` 做第一次验证。',
        '4. 如需停用自动启动，运行 `node dist/cli.js service uninstall`。'
      ];
    }

    return [
      '1. 自动启动服务尚未成功加载。',
      '2. 运行 `node dist/cli.js service install` 再次安装自动启动服务。',
      '3. 再用 `node dist/cli.js service status` 和 `node dist/cli.js status` 确认状态。',
      '4. 如果你暂时不想折腾自动启动，也可以直接运行 `node dist/cli.js start` 或 `node dist/cli.js start --daemon`。'
    ];
  }

  return [
    '1. 运行 `node dist/cli.js start` 或 `node dist/cli.js start --daemon` 启动微信派活 worker。',
    '2. 只有看到“worker 模式已启动”后，微信消息才会收到回复。',
    '3. 在微信里发送 `/echo 你好` 做第一次验证。'
  ];
}

export async function runInstallCommand(): Promise<void> {
  const config = await runInstallWizard();
  if (config.mode === 'channels') {
    await syncChannelsLocalConfig(process.cwd());
  }

  const completionState: InstallCompletionState = {};
  if (config.mode === 'worker' && config.preferredAutoStart && isLaunchdSupported()) {
    completionState.autoStartAttempted = true;
    try {
      await installLaunchdService(config);
      const status = await getLaunchdStatus();
      completionState.autoStartLoaded = status.loaded;
      if (status.loaded) {
        console.log('\n已自动安装并启动 worker 自动启动服务。');
      }
    } catch (error) {
      completionState.autoStartError = error instanceof Error ? error.message : String(error);
    }
  }

  if (!(config.mode === 'worker' && config.preferredAutoStart && completionState.autoStartLoaded)) {
    console.log('\n注意：安装向导只会保存配置，不会自动启动消息监听。');
  }

  if (completionState.autoStartError) {
    console.log(`\n自动启动服务安装失败：${completionState.autoStartError}`);
  }
  console.log('\n下一步：');
  for (const line of buildInstallNextSteps(config, completionState)) {
    console.log(line);
  }
}
