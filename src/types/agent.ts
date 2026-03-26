import type { RuntimeMode } from './install.js';

export type TaskStage =
  | 'idle'
  | 'queued'
  | 'analyzing'
  | 'editing'
  | 'validating'
  | 'completed'
  | 'failed';

export interface ConversationTaskStatus {
  conversationId: string;
  stage: TaskStage;
  active: boolean;
  taskPreview?: string;
  summary?: string;
  lastError?: string;
  startedAt?: string;
  updatedAt: string;
  completedAt?: string;
}

export interface RuntimeStatusSnapshot {
  running: boolean;
  mode?: RuntimeMode;
  daemon?: boolean;
  pid?: number;
  workspaceRoot?: string;
  logPath?: string;
  startedAt?: string;
  lastExitAt?: string;
  updatedAt: string;
  conversations: Record<string, ConversationTaskStatus>;
}
