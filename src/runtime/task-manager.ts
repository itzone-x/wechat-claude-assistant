import type { InstallConfig } from '../types/install.js';
import type { WorkerMessage } from '../types/ilink.js';
import {
  buildTaskPreview,
  clearConversationStatus,
  formatConversationStatus,
  stageMessage,
  updateConversationStatus,
  loadRuntimeStatus
} from './progress.js';
import { resetConversationSession } from './conversation-store.js';
import type { AgentRunner, RunningAgentRun } from './agent-runner.js';
import { parseWorkerCommand, workerHelpText } from './worker-commands.js';

type SendReplyFn = (
  text: string,
  toUserId?: string,
  contextToken?: string
) => Promise<unknown>;

interface RunningTask {
  conversationId: string;
  contextToken: string;
  run: RunningAgentRun | null;
  timers: NodeJS.Timeout[];
}

function splitMessage(text: string, chunkSize = 1200): string[] {
  if (text.length <= chunkSize) {
    return [text];
  }

  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += chunkSize) {
    chunks.push(text.slice(index, index + chunkSize));
  }
  return chunks;
}

function shortSummary(text: string, maxLength = 240): string {
  const value = text.trim();
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}…`;
}

function buildMessageTaskPreview(message: WorkerMessage): string {
  const attachments = message.attachments || [];
  const imageCount = attachments.filter((attachment) => attachment.type === 'image').length;
  const audioCount = attachments.filter((attachment) => attachment.type === 'audio').length;
  const attachmentsCount = attachments.length;
  const textPreview = buildTaskPreview(message.text);
  const attachmentSummary = [
    imageCount > 0 ? `${imageCount} 张图片` : '',
    audioCount > 0 ? `${audioCount} 段语音` : ''
  ].filter(Boolean).join('、');

  if (textPreview) {
    return attachmentsCount > 0
      ? `${textPreview}（附 ${attachmentSummary}）`
      : textPreview;
  }

  if (imageCount > 0 && audioCount === 0) {
    return `图片任务（${imageCount} 张图片）`;
  }

  if (audioCount > 0 && imageCount === 0) {
    return `语音任务（${audioCount} 段语音）`;
  }

  if (attachmentsCount > 0) {
    return `多模态任务（${attachmentSummary}）`;
  }

  return '';
}

export class TaskManager {
  private readonly activeTasks = new Map<string, RunningTask>();
  private stopping = false;

  constructor(
    private readonly config: InstallConfig,
    private readonly sendReply: SendReplyFn,
    private readonly runner: AgentRunner,
    private readonly longRunningNoticeDelayMs = 5000
  ) {}

  private async safeReply(
    text: string,
    toUserId: string,
    contextToken: string
  ): Promise<void> {
    try {
      await this.sendReply(text, toUserId, contextToken);
    } catch (error) {
      console.error(`[worker] 回微信失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async shutdown(): Promise<void> {
    this.stopping = true;

    for (const task of this.activeTasks.values()) {
      task.timers.forEach((timer) => clearTimeout(timer));
      task.run?.cancel('SIGTERM');
    }
  }

  hasActiveTask(conversationId: string): boolean {
    return this.activeTasks.has(conversationId);
  }

  async handleMessage(message: WorkerMessage): Promise<void> {
    const text = message.text.trim();
    const hasAttachments = (message.attachments?.length || 0) > 0;
    if (!text && !hasAttachments) {
      return;
    }

    const command = text ? parseWorkerCommand(text) : null;
    if (command) {
      await this.handleCommand(message, command);
      return;
    }

    if (this.stopping) {
      await this.safeReply(
        '助手正在停止中，请稍后再试。',
        message.fromUserId,
        message.contextToken
      );
      return;
    }

    if (this.activeTasks.has(message.fromUserId)) {
      await this.safeReply(
        '当前已有任务在运行。发送 /status 查看进度，或等任务完成后再发新任务。',
        message.fromUserId,
        message.contextToken
      );
      return;
    }

    this.launchTask(message);
  }

  private async handleCommand(
    message: WorkerMessage,
    command: ReturnType<typeof parseWorkerCommand>
  ): Promise<void> {
    if (!command) {
      return;
    }

    switch (command.type) {
      case 'help':
        await this.safeReply(workerHelpText(), message.fromUserId, message.contextToken);
        return;
      case 'echo':
        await this.safeReply(
          command.text || '收到',
          message.fromUserId,
          message.contextToken
        );
        return;
      case 'status': {
        const snapshot = await loadRuntimeStatus();
        const status = snapshot.conversations[message.fromUserId];
        await this.safeReply(
          formatConversationStatus(status),
          message.fromUserId,
          message.contextToken
        );
        return;
      }
      case 'reset':
        if (this.activeTasks.has(message.fromUserId)) {
          await this.safeReply(
            '当前任务还在运行，暂时不能重置会话。',
            message.fromUserId,
            message.contextToken
          );
          return;
        }
        await resetConversationSession(message.fromUserId);
        await clearConversationStatus(message.fromUserId);
        await this.safeReply(
          '已重置当前微信会话对应的 Claude 会话，下一个任务会从新上下文开始。',
          message.fromUserId,
          message.contextToken
        );
        return;
      default:
        await this.safeReply(
          `不支持的命令：${command.raw}\n\n${workerHelpText()}`,
          message.fromUserId,
          message.contextToken
        );
    }
  }

  private launchTask(message: WorkerMessage): void {
    const conversationId = message.fromUserId;
    const task: RunningTask = {
      conversationId,
      contextToken: message.contextToken,
      run: null,
      timers: []
    };

    this.activeTasks.set(conversationId, task);
    void this.runTask(message, task);
  }

  private async runTask(message: WorkerMessage, task: RunningTask): Promise<void> {
    const conversationId = message.fromUserId;
    const taskPreview = buildMessageTaskPreview(message);

    try {
      await updateConversationStatus(conversationId, {
        stage: 'queued',
        active: true,
        taskPreview,
        startedAt: new Date().toISOString(),
        summary: undefined,
        lastError: undefined,
        completedAt: undefined
      });

      task.run = this.runner.start({
        conversationId,
        workspaceRoot: this.config.workspaceRoot,
        approvalPolicy: this.config.approvalPolicy,
        taskText: message.text,
        attachments: message.attachments
      });

      task.timers.push(setTimeout(async () => {
        if (!this.activeTasks.has(conversationId)) {
          return;
        }
        await this.safeReply(
          '处理中，发送 /status 可查看进展。',
          message.fromUserId,
          message.contextToken
        );
      }, this.longRunningNoticeDelayMs));

      const updateStageLater = (stage: 'editing' | 'validating', delayMs: number) => {
        task.timers.push(setTimeout(async () => {
          if (!this.activeTasks.has(conversationId)) {
            return;
          }
          try {
            await updateConversationStatus(conversationId, {
              stage,
              active: true
            });
          } catch (error) {
            console.error(`[worker] 更新阶段失败: ${error instanceof Error ? error.message : String(error)}`);
          }
        }, delayMs));
      };

      await updateConversationStatus(conversationId, {
        stage: 'analyzing',
        active: true
      });

      updateStageLater('editing', 3000);
      updateStageLater('validating', 12000);

      const result = await task.run.completion;

      if (result.exitCode === 0) {
        const summary = result.stdout || '任务已完成，但 Claude Code 没有返回可展示的摘要。';
        await updateConversationStatus(conversationId, {
          stage: 'completed',
          active: false,
          summary: shortSummary(summary),
          completedAt: new Date().toISOString()
        });
        for (const chunk of splitMessage(summary)) {
          await this.safeReply(chunk, message.fromUserId, message.contextToken);
        }
        return;
      }

      const errorText = result.stderr || result.stdout || '未知错误';
      await updateConversationStatus(conversationId, {
        stage: 'failed',
        active: false,
        lastError: shortSummary(errorText),
        completedAt: new Date().toISOString()
      });
      for (const chunk of splitMessage(`任务执行失败：\n${errorText}`)) {
        await this.safeReply(chunk, message.fromUserId, message.contextToken);
      }
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      console.error(`[worker] 任务内部错误: ${errorText}`);
      await updateConversationStatus(conversationId, {
        stage: 'failed',
        active: false,
        lastError: shortSummary(errorText),
        completedAt: new Date().toISOString()
      });
      for (const chunk of splitMessage(`任务执行失败：\n${errorText}`)) {
        await this.safeReply(chunk, message.fromUserId, message.contextToken);
      }
    } finally {
      this.activeTasks.delete(conversationId);
      task.timers.forEach((timer) => clearTimeout(timer));
    }
  }
}
