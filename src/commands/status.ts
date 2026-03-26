import { getDefaultInstallConfig, getStatePaths } from '../core/config.js';
import { loadSavedAccount } from '../core/login-qr.js';
import { getPairedUserIds } from '../core/pairing.js';
import { readJsonFile, readTextFile } from '../core/state.js';
import { loadRuntimeStatus } from '../runtime/progress.js';
import type { InstallConfig } from '../types/install.js';

function isProcessAlive(pid?: number): boolean {
  if (!pid) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      return true;
    }
    return false;
  }
}

export async function runStatusCommand(): Promise<void> {
  const paths = getStatePaths();
  const config = await readJsonFile<InstallConfig>(
    paths.installConfigPath,
    getDefaultInstallConfig()
  );
  const account = await loadSavedAccount();
  const pairedUsers = await getPairedUserIds();
  const runtime = await loadRuntimeStatus();
  const pidFromFile = Number.parseInt((await readTextFile(paths.runtimePidPath, '')).trim(), 10);
  const runtimePid = Number.isFinite(pidFromFile)
    ? pidFromFile
    : (runtime.running ? runtime.pid : undefined);
  const runtimeAlive = runtimePid
    ? isProcessAlive(runtimePid)
    : runtime.running;

  console.log('当前状态：');
  console.log(`- 默认模式: ${config.mode}`);
  console.log(`- 工作目录: ${config.workspaceRoot}`);
  console.log(`- 执行策略: ${config.approvalPolicy}`);
  console.log(`- 自动启动偏好: ${config.preferredAutoStart ? '开启' : '关闭'}`);
  console.log(`- 微信连接: ${account ? '已连接' : '未连接'}`);
  if (account?.userId) {
    console.log(`- 当前登录微信用户: ${account.userId}`);
  }
  console.log(`- 授权用户数: ${pairedUsers.length}`);
  if (pairedUsers.length > 0) {
    console.log(`- 授权列表: ${pairedUsers.join(', ')}`);
  }
  console.log(`- worker 运行中: ${runtimeAlive ? '是' : '否'}`);
  if (runtimePid) {
    console.log(`- worker 进程 PID: ${runtimePid}${runtimeAlive ? '' : '（已失效）'}`);
  }
  if (runtime.logPath) {
    console.log(`- worker 日志文件: ${runtime.logPath}`);
  }

  const activeTasks = Object.values(runtime.conversations).filter((item) => item.active);
  console.log(`- 当前活跃任务数: ${activeTasks.length}`);
  for (const task of activeTasks) {
    console.log(`  - ${task.conversationId}: ${task.stage}${task.taskPreview ? ` - ${task.taskPreview}` : ''}`);
  }
  console.log('- 高级模式: 仅在 Claude Channels 可用时单独启用');
}
