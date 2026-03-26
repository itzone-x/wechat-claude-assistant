import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

import {
  createConversationSession,
  getStoredSessionId,
  resetConversationSession
} from './conversation-store.js';
import { permissionModeFor } from './policy.js';
import type {
  AgentRunner,
  RunningAgentRun,
  WorkerRunRequest,
  WorkerRunResult
} from './agent-runner.js';
import type { WorkerAttachment } from '../types/ilink.js';

export interface ClaudeCodeRunnerOptions {
  command?: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
}

const COMMON_CLAUDE_PATHS = [
  '/usr/local/bin/claude',
  '/opt/homebrew/bin/claude'
];
const EMPTY_MCP_CONFIG_JSON = '{"mcpServers":{}}';
const MISSING_SESSION_PATTERN = /No conversation found with session ID/i;

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveFromPath(pathValue?: string): string | null {
  if (!pathValue?.trim()) {
    return null;
  }

  for (const entry of pathValue.split(delimiter)) {
    const base = entry.trim();
    if (!base) {
      continue;
    }

    const candidate = join(base, 'claude');
    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function resolveClaudeCommand(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.CLAUDE_BIN?.trim();
  if (explicit && isExecutable(explicit)) {
    return explicit;
  }

  const fromPath = resolveFromPath(env.PATH);
  if (fromPath) {
    return fromPath;
  }

  for (const candidate of COMMON_CLAUDE_PATHS) {
    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  return 'claude';
}

export function buildClaudeWorkerPrompt(input: {
  workspaceRoot: string;
  taskText: string;
  attachments?: WorkerAttachment[];
}): string {
  const attachments = input.attachments || [];
  const imageCount = attachments.filter((attachment) => attachment.type === 'image').length;
  const audioCount = attachments.filter((attachment) => attachment.type === 'audio').length;
  const attachmentLines = attachments.map((attachment, index) => {
    const sourceLabel = attachment.source === 'wechat-upload'
      ? '微信上传'
      : '图片链接';
    const itemLabel = attachment.type === 'image' ? '图片' : '语音';
    const extra = attachment.originalUrl ? `；原始链接: ${attachment.originalUrl}` : '';
    return `${itemLabel} ${index + 1}: ${attachment.filePath}（来源: ${sourceLabel}${extra}）`;
  });

  return [
    '你正在处理一个来自微信的本地开发任务。',
    `请在工作目录 ${input.workspaceRoot} 内完成任务。`,
    '不要调用任何 MCP、插件或微信回复工具；worker 会自动把你的最终文字结果回传到微信。',
    imageCount > 0 || audioCount > 0
      ? `本次任务还附带${[
          imageCount > 0 ? `图片输入（${imageCount} 张）` : '',
          audioCount > 0 ? `语音输入（${audioCount} 段）` : ''
        ].filter(Boolean).join('、')}，请结合这些输入与用户文字一起理解和回答。`
      : '',
    audioCount > 0
      ? '如果任务文本里已经包含微信自动转写的语音内容，请优先结合该转写；语音文件路径可作为补充上下文。'
      : '',
    ...attachmentLines,
    attachments.length > 0 && !input.taskText.trim()
      ? '用户没有提供额外文字，请先概括附件里的关键信息，再给出有帮助的回复。'
      : '',
    '完成后请用中文简短总结：做了什么、改了哪些文件、如何验证。',
    '',
    '用户任务：',
    input.taskText.trim() || '用户只发送了图片，没有补充文字。'
  ].join('\n');
}

export class ClaudeCodeRunner implements AgentRunner {
  private readonly command: string;
  private readonly args: string[];
  private readonly env: NodeJS.ProcessEnv;

  constructor(options: ClaudeCodeRunnerOptions = {}) {
    this.env = options.env || process.env;
    this.command = options.command || resolveClaudeCommand(this.env);
    this.args = options.args || [];
  }

  start(request: WorkerRunRequest): RunningAgentRun {
    let child: ChildProcessWithoutNullStreams | null = null;

    const completion = (async () => {
      const prompt = buildClaudeWorkerPrompt({
        workspaceRoot: request.workspaceRoot,
        taskText: request.taskText,
        attachments: request.attachments
      });
      const attachmentDirs = Array.from(
        new Set((request.attachments || []).map((attachment) => dirname(attachment.filePath)))
      );

      const runClaude = async (
        sessionId: string,
        resumeExisting: boolean
      ): Promise<WorkerRunResult> => {
        const sessionArgs = resumeExisting
          ? ['--resume', sessionId]
          : ['--session-id', sessionId];

        child = spawn(
          this.command,
          [
            ...this.args,
            '-p',
            prompt,
            ...sessionArgs,
            '--mcp-config',
            EMPTY_MCP_CONFIG_JSON,
            '--strict-mcp-config',
            '--permission-mode',
            permissionModeFor(request.approvalPolicy),
            '--add-dir',
            request.workspaceRoot,
            ...attachmentDirs.flatMap((dir) => ['--add-dir', dir])
          ],
          {
            cwd: request.workspaceRoot,
            env: this.env
          }
        );
        child.stdin.end();

        return await new Promise<WorkerRunResult>((resolve) => {
          let stdout = '';
          let stderr = '';

          child!.stdout.on('data', (chunk) => {
            stdout += String(chunk);
          });

          child!.stderr.on('data', (chunk) => {
            stderr += String(chunk);
          });

          child!.on('error', (error) => {
            stderr += error.message;
          });

          child!.on('close', (exitCode) => {
            resolve({
              exitCode,
              stdout: stdout.trim(),
              stderr: stderr.trim()
            });
          });
        });
      };

      const storedSessionId = await getStoredSessionId(
        request.conversationId,
        request.workspaceRoot
      );
      const sessionId = storedSessionId
        ?? await createConversationSession(request.conversationId, request.workspaceRoot);

      const firstResult = await runClaude(sessionId, Boolean(storedSessionId));
      if (
        storedSessionId &&
        firstResult.exitCode !== 0 &&
        MISSING_SESSION_PATTERN.test(`${firstResult.stderr}\n${firstResult.stdout}`)
      ) {
        await resetConversationSession(request.conversationId, request.workspaceRoot);
        const freshSessionId = await createConversationSession(
          request.conversationId,
          request.workspaceRoot
        );
        return await runClaude(freshSessionId, false);
      }

      return firstResult;
    })();

    return {
      completion,
      cancel: (signal = 'SIGTERM') => {
        if (child && !child.killed) {
          child.kill(signal);
        }
      }
    };
  }
}
