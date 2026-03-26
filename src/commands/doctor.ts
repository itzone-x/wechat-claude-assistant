import { spawnSync } from 'node:child_process';
import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname } from 'node:path';

import { getDefaultInstallConfig, getStatePaths } from '../core/config.js';
import { syncChannelsLocalConfig } from '../core/channels-config.js';
import { analyzeChannelsSettings, expectedChannelsFilesStatus } from '../core/channels-validation.js';
import { fileExists, readJsonFile, readTextFile } from '../core/state.js';
import { loadSavedAccountWithOptions } from '../core/login-qr.js';
import { getPairedUserIds } from '../core/pairing.js';
import type { InstallConfig } from '../types/install.js';

export interface DoctorCheck {
  label: string;
  status: 'ok' | 'warn' | 'fail';
  detail: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  ok: boolean;
}

export interface DoctorOptions {
  includeChannelsChecks?: boolean;
}

export function buildDoctorGuidance(): string[] {
  return [
    'Worker 联调建议：',
    '1. `node dist/cli.js login` 确认微信登录有效',
    '2. `node dist/cli.js start` 或 `node dist/cli.js start --daemon` 启动微信派活 worker',
    '3. 从微信发送 `/echo 你好` 验证基本收发',
    '4. 再发送一条真实任务，观察微信里的阶段回传和最终结果',
    '',
    '高级模式（可选）：',
    '1. `npm test` 确认本地桥接测试通过',
    '2. 只有在 Claude Channels 可用时，再运行 `node dist/cli.js start --mode channels`',
    '3. 在 Claude Code 中确认已加载 `.mcp.json` 或 `.claude-plugin/plugin.json`'
  ];
}

function parseNodeMajor(version: string): number {
  return Number.parseInt(version.replace(/^v/, '').split('.')[0] || '0', 10);
}

async function canAccessPath(
  targetPath: string,
  mode: number
): Promise<boolean> {
  try {
    await access(targetPath, mode);
    return true;
  } catch {
    return false;
  }
}

async function getNearestExistingParent(targetPath: string): Promise<string | null> {
  let current = targetPath;

  while (true) {
    try {
      await stat(current);
      return current;
    } catch {}

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

export async function checkStateDirectory(stateDir: string): Promise<DoctorCheck> {
  try {
    const info = await stat(stateDir);
    if (!info.isDirectory()) {
      return {
        label: '状态目录',
        status: 'fail',
        detail: `目标路径不是目录: ${stateDir}`
      };
    }

    const readable = await canAccessPath(stateDir, constants.R_OK);
    const writable = await canAccessPath(stateDir, constants.W_OK);
    return {
      label: '状态目录',
      status: readable && writable ? 'ok' : 'fail',
      detail: readable && writable
        ? `可读写: ${stateDir}`
        : `目录存在，但权限不足: ${stateDir}`
    };
  } catch {}

  const parent = await getNearestExistingParent(dirname(stateDir));
  if (!parent) {
    return {
      label: '状态目录',
      status: 'fail',
      detail: `无法找到可检查的父目录: ${stateDir}`
    };
  }

  const writable = await canAccessPath(parent, constants.W_OK);
  return {
    label: '状态目录',
    status: writable ? 'warn' : 'fail',
    detail: writable
      ? `目录尚未创建，但首次运行时可创建: ${stateDir}`
      : `无法在父目录中创建状态目录: ${stateDir}`
  };
}

export async function runDoctor(
  options: DoctorOptions = {}
): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const paths = getStatePaths();
  const includeChannelsChecks = options.includeChannelsChecks === true;
  const config = await readJsonFile<InstallConfig>(
    paths.installConfigPath,
    getDefaultInstallConfig()
  );

  const nodeMajor = parseNodeMajor(process.version);
  checks.push({
    label: 'Node.js',
    status: nodeMajor >= 18 ? 'ok' : 'fail',
    detail: `当前版本 ${process.version}，推荐 Node.js 18+`
  });

  const claudeVersion = spawnSync('claude', ['--version'], {
    encoding: 'utf-8'
  });
  checks.push({
    label: 'Claude Code',
    status: claudeVersion.status === 0 ? 'ok' : 'warn',
    detail: claudeVersion.status === 0
      ? claudeVersion.stdout.trim()
      : '未检测到可用的 claude 命令'
  });

  checks.push(await checkStateDirectory(paths.stateDir));

  const account = await loadSavedAccountWithOptions({ migrateLegacy: false });
  checks.push({
    label: '微信连接',
    status: account ? 'ok' : 'warn',
    detail: account
      ? `已连接${account.userId ? `，用户 ${account.userId}` : ''}`
      : '尚未连接微信'
  });

  const pairedUsers = await getPairedUserIds();
  checks.push({
    label: '授权微信用户',
    status: pairedUsers.length > 0 ? 'ok' : 'warn',
    detail: pairedUsers.length > 0
      ? `已授权 ${pairedUsers.length} 个用户`
      : '还没有授权微信用户'
  });

  const workspaceOk = await stat(config.workspaceRoot)
    .then((value) => value.isDirectory())
    .catch(() => false);
  checks.push({
    label: 'Worker 工作目录',
    status: workspaceOk ? 'ok' : 'fail',
    detail: workspaceOk
      ? `已配置: ${config.workspaceRoot}`
      : `工作目录不存在: ${config.workspaceRoot}`
  });

  checks.push({
    label: 'Worker 构建产物',
    status: await fileExists('dist/cli.js') ? 'ok' : 'warn',
    detail: await fileExists('dist/cli.js')
      ? '检测到 dist/cli.js，可供 worker 与高级模式共用'
      : '尚未检测到 dist/cli.js，请先运行 `npm run build`'
  });

  if (includeChannelsChecks) {
    checks.push({
      label: '高级模式 MCP 配置',
      status: await fileExists('.mcp.json') ? 'ok' : 'warn',
      detail: await fileExists('.mcp.json')
        ? '检测到当前目录存在 .mcp.json'
        : '当前目录还没有 .mcp.json'
    });

    const pluginManifestExists = await fileExists('.claude-plugin/plugin.json');
    const pluginMcpExists = await fileExists('plugin.mcp.json');
    const channelsFilesCheck = expectedChannelsFilesStatus(
      pluginManifestExists,
      pluginMcpExists
    );
    checks.push({
      label: '高级模式插件包装',
      status: channelsFilesCheck.status,
      detail: channelsFilesCheck.detail
    });

    const settingsAnalysis = analyzeChannelsSettings(
      await readTextFile('.claude/settings.local.json', '{}')
    );
    checks.push({
      label: '高级模式本地权限',
      status: settingsAnalysis.status,
      detail: settingsAnalysis.detail
    });
  }

  return {
    checks,
    ok: !checks.some((check) => check.status === 'fail')
  };
}

function printDoctorReport(report: DoctorReport): void {
  console.log('环境检查结果：');
  for (const check of report.checks) {
    console.log(`[${check.status.toUpperCase()}] ${check.label} - ${check.detail}`);
  }
}

export async function runDoctorCommand(args: string[] = []): Promise<void> {
  const shouldFix = args.includes('--fix');
  const includeChannelsChecks = args.includes('--channels')
    || args.includes('--advanced')
    || shouldFix;

  let report = await runDoctor({ includeChannelsChecks });
  printDoctorReport(report);

  if (shouldFix) {
    const result = await syncChannelsLocalConfig(process.cwd());
    console.log('\n已自动同步 channels 本地配置：');
    console.log(`- MCP 配置: ${result.mcpPath}`);
    console.log(`- Claude 本地权限: ${result.settingsPath}`);

    report = await runDoctor({ includeChannelsChecks: true });
    console.log('\n修复后的检查结果：');
    for (const check of report.checks) {
      console.log(`[${check.status.toUpperCase()}] ${check.label} - ${check.detail}`);
    }
  }

  if (!report.ok) {
    process.exitCode = 1;
  }

  console.log('');
  buildDoctorGuidance().forEach((line) => {
    console.log(line);
  });
}
