import { getStatePaths } from '../core/config.js';
import { deleteFile, readTextFile } from '../core/state.js';
import { getLaunchdStatus, stopLaunchdService } from '../core/launchd.js';
import { markRuntimeStopped } from '../runtime/progress.js';

function isProcessAlive(pid: number): boolean {
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

export async function runStopCommand(): Promise<void> {
  const paths = getStatePaths();
  const launchdStatus = await getLaunchdStatus();

  if (launchdStatus.loaded) {
    await stopLaunchdService();
    await deleteFile(paths.runtimePidPath);
    await markRuntimeStopped();
    console.log('已停止由 launchd 托管的 worker，后台进程不会自动重启。');
    console.log('如需重新启用自动启动，请运行 `node dist/cli.js service install`。');
    return;
  }

  const pidText = (await readTextFile(paths.runtimePidPath, '')).trim();

  if (!pidText) {
    console.log('当前没有检测到正在运行的后台进程。');
    return;
  }

  const pid = Number.parseInt(pidText, 10);
  if (!Number.isFinite(pid) || pid <= 0) {
    await deleteFile(paths.runtimePidPath);
    console.log('后台进程 PID 文件无效，已清理。');
    return;
  }

  if (!isProcessAlive(pid)) {
    await deleteFile(paths.runtimePidPath);
    await markRuntimeStopped();
    console.log(`后台进程 ${pid} 已不存在，已清理状态。`);
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');
    console.log(`已发送停止信号到后台进程 ${pid}。`);
  } catch (error) {
    throw new Error(`停止后台进程失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}
