import { getStatePaths } from '../core/config.js';
import { readJsonFile, writeJsonFile } from '../core/state.js';
import type {
  ConversationTaskStatus,
  RuntimeStatusSnapshot,
  TaskStage
} from '../types/agent.js';
import type { RuntimeMode } from '../types/install.js';

const STAGE_MESSAGES: Record<Exclude<TaskStage, 'idle'>, string> = {
  queued: '已收到任务，正在排队处理。',
  analyzing: '正在分析任务和工作区。',
  editing: '任务仍在执行，正在处理修改。',
  validating: '正在整理结果并准备回传。',
  completed: '任务已完成。',
  failed: '任务执行失败。'
};

function defaultRuntimeStatus(): RuntimeStatusSnapshot {
  return {
    running: false,
    updatedAt: new Date().toISOString(),
    conversations: {}
  };
}

export async function loadRuntimeStatus(): Promise<RuntimeStatusSnapshot> {
  return await readJsonFile<RuntimeStatusSnapshot>(
    getStatePaths().runtimeStatusPath,
    defaultRuntimeStatus()
  );
}

async function saveRuntimeStatus(snapshot: RuntimeStatusSnapshot): Promise<void> {
  snapshot.updatedAt = new Date().toISOString();
  await writeJsonFile(getStatePaths().runtimeStatusPath, snapshot);
}

export function buildTaskPreview(text: string, maxLength = 80): string {
  const oneLine = text.trim().replace(/\s+/g, ' ');
  if (oneLine.length <= maxLength) {
    return oneLine;
  }
  return `${oneLine.slice(0, maxLength - 1)}…`;
}

export function stageMessage(stage: Exclude<TaskStage, 'idle'>): string {
  return STAGE_MESSAGES[stage];
}

export async function markRuntimeStarted(options: {
  mode: RuntimeMode;
  daemon: boolean;
  workspaceRoot: string;
  pid: number;
  logPath?: string;
}): Promise<void> {
  const snapshot = await loadRuntimeStatus();
  const now = new Date().toISOString();
  snapshot.running = true;
  snapshot.mode = options.mode;
  snapshot.daemon = options.daemon;
  snapshot.pid = options.pid;
  snapshot.workspaceRoot = options.workspaceRoot;
  snapshot.logPath = options.logPath;
  snapshot.startedAt = now;
  snapshot.lastExitAt = undefined;
  await saveRuntimeStatus(snapshot);
}

export async function markRuntimeStopped(expectedPid?: number): Promise<void> {
  const snapshot = await loadRuntimeStatus();
  if (
    typeof expectedPid === 'number'
    && typeof snapshot.pid === 'number'
    && snapshot.pid !== expectedPid
  ) {
    return;
  }
  snapshot.running = false;
  snapshot.pid = undefined;
  snapshot.lastExitAt = new Date().toISOString();
  await saveRuntimeStatus(snapshot);
}

export async function updateConversationStatus(
  conversationId: string,
  patch: Partial<ConversationTaskStatus> & Pick<ConversationTaskStatus, 'stage' | 'active'>
): Promise<ConversationTaskStatus> {
  const snapshot = await loadRuntimeStatus();
  const now = new Date().toISOString();
  const previous = snapshot.conversations[conversationId];
  const next: ConversationTaskStatus = {
    conversationId,
    stage: patch.stage,
    active: patch.active,
    taskPreview: Object.prototype.hasOwnProperty.call(patch, 'taskPreview')
      ? patch.taskPreview
      : previous?.taskPreview,
    summary: Object.prototype.hasOwnProperty.call(patch, 'summary')
      ? patch.summary
      : previous?.summary,
    lastError: Object.prototype.hasOwnProperty.call(patch, 'lastError')
      ? patch.lastError
      : previous?.lastError,
    startedAt: Object.prototype.hasOwnProperty.call(patch, 'startedAt')
      ? patch.startedAt
      : previous?.startedAt ?? now,
    updatedAt: now,
    completedAt: Object.prototype.hasOwnProperty.call(patch, 'completedAt')
      ? patch.completedAt
      : previous?.completedAt
  };

  if (!next.active && (next.stage === 'completed' || next.stage === 'failed')) {
    next.completedAt = patch.completedAt ?? now;
  }

  snapshot.conversations[conversationId] = next;
  await saveRuntimeStatus(snapshot);
  return next;
}

export async function clearConversationStatus(conversationId: string): Promise<void> {
  const snapshot = await loadRuntimeStatus();
  delete snapshot.conversations[conversationId];
  await saveRuntimeStatus(snapshot);
}

export function formatConversationStatus(status?: ConversationTaskStatus): string {
  if (!status) {
    return '当前没有正在运行的任务。';
  }

  const parts = [
    `阶段: ${status.stage}`,
    status.taskPreview ? `任务: ${status.taskPreview}` : '',
    status.summary ? `摘要: ${status.summary}` : '',
    status.lastError ? `错误: ${status.lastError}` : '',
    status.startedAt ? `开始时间: ${status.startedAt}` : '',
    `最近更新时间: ${status.updatedAt}`
  ].filter(Boolean);

  return parts.join('\n');
}
