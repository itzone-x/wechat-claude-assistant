import type { WorkerAttachment } from '../types/ilink.js';
import type { ApprovalPolicy } from '../types/install.js';

export interface WorkerRunRequest {
  conversationId: string;
  workspaceRoot: string;
  approvalPolicy: ApprovalPolicy;
  taskText: string;
  attachments?: WorkerAttachment[];
}

export interface WorkerRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface RunningAgentRun {
  completion: Promise<WorkerRunResult>;
  cancel(signal?: NodeJS.Signals): void;
}

export interface AgentRunner {
  start(request: WorkerRunRequest): RunningAgentRun;
}
