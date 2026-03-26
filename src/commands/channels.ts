import { syncChannelsLocalConfig } from '../core/channels-config.js';

export function getChannelsHelpText(): string {
  return `channels 用法（高级模式）:
  node dist/cli.js channels setup

说明:
  setup  同步当前项目的 .mcp.json 和 .claude/settings.local.json

注意:
  channels 只适合已经满足 Claude Channels 条件的高级用户
  默认推荐路径仍然是 \`node dist/cli.js start\`
`;
}

function printHelp(): void {
  console.log(getChannelsHelpText());
}

export async function runChannelsCommand(args: string[]): Promise<void> {
  const subcommand = args[0] || 'help';

  switch (subcommand) {
    case 'setup': {
      const result = await syncChannelsLocalConfig(process.cwd());
      console.log('已同步 channels 本地配置。');
      console.log(`- MCP 配置: ${result.mcpPath}`);
      console.log(`- Claude 本地权限: ${result.settingsPath}`);
      console.log('如果当前项目还没有最新构建产物，请先运行 `npm run build`。');
      console.log('下一步可运行 `node dist/cli.js doctor` 再做一次检查。');
      console.log('如果你只是要跑微信派活，不需要使用 channels，直接执行 `node dist/cli.js start`。');
      return;
    }
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      return;
    default:
      printHelp();
      throw new Error(`未知 channels 子命令: ${subcommand}`);
  }
}
