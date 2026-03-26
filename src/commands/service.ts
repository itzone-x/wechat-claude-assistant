import { getDefaultInstallConfig, getStatePaths } from '../core/config.js';
import {
  buildLaunchdPlist,
  getLaunchdStatus,
  installLaunchdService,
  isLaunchdSupported,
  uninstallLaunchdService
} from '../core/launchd.js';
import { readJsonFile } from '../core/state.js';
import type { InstallConfig } from '../types/install.js';
import { validateWorkerConfig } from '../runtime/policy.js';

function readSubcommand(args: string[]): string {
  return args[0] || 'help';
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function readValueArg(args: string[], flag: string): string | undefined {
  const index = args.findIndex((arg) => arg === flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function printHelp(): void {
  console.log(`service 用法（仅作用于微信派活 worker）:
  node dist/cli.js service install
  node dist/cli.js service uninstall
  node dist/cli.js service status
  node dist/cli.js service print

可选参数:
  --write-only              只写入或删除 plist，不调用 launchctl
  --launch-agents-dir PATH  自定义 LaunchAgents 目录，便于测试
`);
}

export async function runServiceCommand(args: string[]): Promise<void> {
  const subcommand = readSubcommand(args);
  const writeOnly = hasFlag(args, '--write-only');
  const launchAgentsDir = readValueArg(args, '--launch-agents-dir');
  const options = { writeOnly, launchAgentsDir };

  if (!isLaunchdSupported()) {
    console.log('当前系统不是 macOS，暂不支持 launchd 自动启动。');
    return;
  }

  const config = await validateWorkerConfig(
    await readJsonFile<InstallConfig>(
      getStatePaths().installConfigPath,
      getDefaultInstallConfig()
    )
  );

  switch (subcommand) {
    case 'install': {
      const path = await installLaunchdService({
        ...config,
        mode: 'worker'
      }, options);
      console.log(writeOnly
        ? `已写入 worker launchd plist: ${path}`
        : `已安装并启动 worker launchd 服务: ${path}`);
      return;
    }
    case 'uninstall': {
      const path = await uninstallLaunchdService(options);
      console.log(writeOnly
        ? `已删除 worker launchd plist: ${path}`
        : `已移除 worker launchd 服务: ${path}`);
      return;
    }
    case 'status': {
      const status = await getLaunchdStatus(options);
      console.log('worker 自动启动状态：');
      console.log(`- 支持: ${status.supported ? '是' : '否'}`);
      console.log(`- 已安装: ${status.installed ? '是' : '否'}`);
      console.log(`- 已加载: ${status.loaded ? '是' : '否'}`);
      console.log(`- 标签: ${status.label}`);
      console.log(`- plist 路径: ${status.launchAgentPath}`);
      return;
    }
    case 'print':
      console.log(buildLaunchdPlist({
        ...config,
        mode: 'worker'
      }));
      return;
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      return;
    default:
      printHelp();
      throw new Error(`未知 service 子命令: ${subcommand}`);
  }
}
