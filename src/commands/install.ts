import { runInstallWizard } from '../ui/wizard.js';
import type { InstallConfig } from '../types/install.js';
import { isLaunchdSupported } from '../core/launchd.js';
import { syncChannelsLocalConfig } from '../core/channels-config.js';

export async function runInstallCommand(): Promise<void> {
  const config = await runInstallWizard();
  if (config.mode === 'channels') {
    await syncChannelsLocalConfig(process.cwd());
  }

  console.log('\n注意：安装向导只会保存配置，不会自动启动消息监听。');
  console.log('\n下一步：');
  if (config.mode === 'channels') {
    console.log('1. 运行 `npm run build`');
    console.log('2. 如有需要，运行 `node dist/cli.js channels setup` 重新同步高级模式配置');
    console.log('3. 仅在你已经满足 Claude Channels 使用条件时，运行 `node dist/cli.js start --mode channels`');
  } else {
    console.log('1. 运行 `npm run build`');
    console.log('2. 运行 `node dist/cli.js start` 或 `node dist/cli.js start --daemon` 启动微信派活 worker');
    console.log('3. 只有看到“worker 模式已启动”后，微信消息才会收到回复');
    if (config.preferredAutoStart && isLaunchdSupported()) {
      console.log('4. 如需开机自动运行，执行 `node dist/cli.js service install` 安装自动启动服务');
    }
  }
}
