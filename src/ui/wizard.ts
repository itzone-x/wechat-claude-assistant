import { resolve } from 'node:path';

import { getDefaultInstallConfig, getStatePaths, APP_NAME } from '../core/config.js';
import { loadSavedAccount, performLogin } from '../core/login-qr.js';
import { readJsonFile, writeJsonFile } from '../core/state.js';
import { ask, choose, confirm } from './prompts.js';
import type {
  ApprovalPolicy,
  InstallConfig,
  RuntimeMode,
  WorkspacePolicy
} from '../types/install.js';
import { runDoctor } from '../commands/doctor.js';
import type { ChoiceOption } from './prompts.js';

function describeMode(mode: RuntimeMode): string {
  return mode === 'worker'
    ? '微信派活，本地后台执行 Claude Code'
    : '高级模式：把微信消息桥接进当前 Claude Code 会话';
}

export function getModeChoices(): ChoiceOption<RuntimeMode>[] {
  return [
    {
      value: 'worker',
      label: '快速开始（推荐）',
      description: '微信派活，本地后台执行任务'
    },
    {
      value: 'channels',
      label: '高级模式',
      description: '仅适合已满足 Claude Channels 条件的高级用户'
    }
  ];
}

export async function runInstallWizard(): Promise<InstallConfig> {
  console.log(`${APP_NAME}\n`);
  console.log('接下来会完成环境检查、模式选择、微信连接和首次配置。');
  console.log('默认推荐“微信派活”模式，你扫码后就可以直接从微信给本地 Claude Code 派任务。');
  console.log('只有在你明确需要桥接当前 Claude Code 会话时，再使用高级模式。\n');

  const proceed = await confirm('是否继续安装？', true);
  if (!proceed) {
    throw new Error('安装已取消。');
  }

  console.log('\n[1/5] 正在检查本机环境...');
  const report = await runDoctor();
  report.checks.forEach((check) => {
    console.log(`- [${check.status.toUpperCase()}] ${check.label}: ${check.detail}`);
  });

  console.log('\n[2/5] 选择运行模式');
  const mode = await choose<RuntimeMode>(
    '请选择默认模式：',
    getModeChoices(),
    'worker'
  );

  console.log(`已选择：${describeMode(mode)}\n`);

  console.log('[3/5] 设置工作目录与执行策略');
  const workspacePolicy = await choose<WorkspacePolicy>(
    '请选择 Claude Code 运行工作区：',
    [
      {
        value: 'current_project',
        label: '仅当前项目目录（推荐）',
        description: process.cwd()
      },
      {
        value: 'custom_path',
        label: '手动指定目录',
        description: '适合你想绑定到别的仓库'
      }
    ],
    'current_project'
  );

  let workspaceRoot = process.cwd();
  if (workspacePolicy === 'custom_path') {
    workspaceRoot = resolve(
      await ask('请输入要绑定的项目目录', process.cwd())
    );
  }

  const approvalPolicy = await choose<ApprovalPolicy>(
    '请选择默认执行策略：',
    [
      {
        value: 'sensitive_confirmation',
        label: '敏感操作先确认（推荐）',
        description: '更稳妥'
      },
      {
        value: 'auto_low_risk',
        label: '自动执行低风险操作',
        description: '更省心'
      },
      {
        value: 'fully_manual',
        label: '完全手动',
        description: '更保守'
      }
    ],
    'sensitive_confirmation'
  );

  let preferredAutoStart = false;
  if (mode === 'worker') {
    preferredAutoStart = await confirm(
      '是否希望在本机开启自动启动？推荐为“是”，以后不用再手动打开终端。',
      true
    );
  }

  console.log('\n[4/5] 连接微信');
  const existing = await loadSavedAccount();
  let shouldLogin = !existing;

  if (existing) {
    const reuse = await confirm(
      `检测到已连接微信${existing.userId ? `（${existing.userId}）` : ''}，是否继续使用？`,
      true
    );
    shouldLogin = !reuse;
  }

  const account = shouldLogin
    ? await performLogin()
    : existing;

  console.log('\n[5/5] 保存配置');
  const paths = getStatePaths();
  const current = await readJsonFile<InstallConfig>(
    paths.installConfigPath,
    getDefaultInstallConfig(workspaceRoot)
  );
  const now = new Date().toISOString();
  const config: InstallConfig = {
    ...current,
    mode,
    workspacePolicy,
    workspaceRoot,
    approvalPolicy,
    preferredAutoStart,
    installedAt: current.installedAt || now,
    updatedAt: now
  };
  await writeJsonFile(paths.installConfigPath, config);

  console.log('✅ 安装向导已完成。');
  console.log(`默认模式: ${describeMode(config.mode)}`);
  console.log(`工作目录: ${config.workspaceRoot}`);
  console.log(`自动启动偏好: ${config.preferredAutoStart ? '开启' : '关闭'}`);
  if (account?.userId) {
    console.log(`授权微信用户: ${account.userId}`);
  }

  return config;
}
