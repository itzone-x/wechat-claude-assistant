import type { InstallConfig } from '../types/install.js';
import { getPairedUserIds, isPairedUser } from '../core/pairing.js';
import { deleteFile, readTextFile, writeTextFile } from '../core/state.js';
import { getStatePaths } from '../core/config.js';
import { markRuntimeStarted, markRuntimeStopped } from './progress.js';
import { TaskManager } from './task-manager.js';
import { createWechatBridge } from '../core/wechat-bridge.js';
import { ClaudeCodeRunner } from './claude-code-runner.js';

export async function startWorkerRuntime(config: InstallConfig): Promise<void> {
  const pairedUsers = await getPairedUserIds();
  if (pairedUsers.length === 0) {
    throw new Error('还没有授权的微信用户，请先运行 install 或 login 完成绑定。');
  }

  const paths = getStatePaths();
  let stopping = false;
  const wechatBridge = createWechatBridge('worker');
  const runner = new ClaudeCodeRunner();
  const taskManager = new TaskManager(
    config,
    wechatBridge.sendReply.bind(wechatBridge),
    runner
  );
  const requestStop = async (reason: string) => {
    if (stopping) {
      return;
    }
    stopping = true;
    console.log(`[worker] 收到停止信号: ${reason}`);
    await taskManager.shutdown();
  };

  process.once('SIGTERM', () => void requestStop('SIGTERM'));
  process.once('SIGINT', () => void requestStop('SIGINT'));

  await wechatBridge.init();
  await writeTextFile(paths.runtimePidPath, String(process.pid));
  await markRuntimeStarted({
    mode: config.mode,
    daemon: process.env.WECHAT_AGENT_DAEMON_CHILD === '1',
    workspaceRoot: config.workspaceRoot,
    pid: process.pid,
    logPath: process.env.WECHAT_AGENT_DAEMON_CHILD === '1'
      ? paths.runtimeLogPath
      : undefined
  });
  console.log(`worker 模式已启动，工作目录: ${config.workspaceRoot}`);
  console.log(`已授权微信用户: ${pairedUsers.join(', ')}`);

  try {
    while (!stopping) {
      try {
        const messages = await wechatBridge.pollMessages();
        if (messages.length === 0) {
          await new Promise((resolve) => setTimeout(resolve, 1200));
          continue;
        }

        for (const message of messages) {
          if (!(await isPairedUser(message.fromUserId))) {
            console.error(`[worker] 忽略未授权用户消息: ${message.fromUserId}`);
            continue;
          }

          if (stopping) {
            break;
          }

          await taskManager.handleMessage(message);
        }
      } catch (error) {
        if (stopping) {
          break;
        }
        console.error(`[worker] 轮询失败: ${error instanceof Error ? error.message : String(error)}`);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  } finally {
    await taskManager.shutdown();
    const pidText = (await readTextFile(paths.runtimePidPath, '')).trim();
    if (pidText === String(process.pid)) {
      await deleteFile(paths.runtimePidPath);
    }
    await markRuntimeStopped(process.pid);
  }
}
