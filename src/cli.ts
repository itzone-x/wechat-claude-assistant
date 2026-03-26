#!/usr/bin/env node
import { runDoctorCommand } from './commands/doctor.js';
import { runChannelsCommand } from './commands/channels.js';
import { runInstallCommand } from './commands/install.js';
import { runLoginCommand } from './commands/login.js';
import { runServiceCommand } from './commands/service.js';
import { runStartCommand } from './commands/start.js';
import { runStatusCommand } from './commands/status.js';
import { runStopCommand } from './commands/stop.js';

function printHelp(): void {
  console.log(`微信 Claude Code 助手

用法:
  node dist/cli.js install      安装向导（默认走微信派活模式）
  node dist/cli.js login        只做微信登录
  node dist/cli.js start        启动微信派活 worker（推荐）
  node dist/cli.js start --daemon
  node dist/cli.js service ...  安装或查看 worker 自动启动服务
  node dist/cli.js stop         停止后台模式
  node dist/cli.js status       查看当前状态
  node dist/cli.js doctor       环境检查
  node dist/cli.js doctor --channels
  node dist/cli.js channels ... 高级模式配置
  node dist/cli.js start --mode channels
  node dist/cli.js doctor --fix 修复高级模式本地配置
`);
}

async function main(): Promise<void> {
  const [, , command = 'help', ...args] = process.argv;

  switch (command) {
    case 'install':
      await runInstallCommand();
      break;
    case 'channels':
      await runChannelsCommand(args);
      break;
    case 'login':
      await runLoginCommand();
      break;
    case 'start':
      await runStartCommand(args);
      break;
    case 'service':
      await runServiceCommand(args);
      break;
    case 'status':
      await runStatusCommand();
      break;
    case 'stop':
      await runStopCommand();
      break;
    case 'doctor':
      await runDoctorCommand(args);
      break;
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      break;
    default:
      printHelp();
      throw new Error(`未知命令: ${command}`);
  }
}

main().catch((error) => {
  console.error(`错误: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
