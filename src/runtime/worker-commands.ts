export type WorkerCommand =
  | { type: 'help' }
  | { type: 'echo'; text: string }
  | { type: 'status' }
  | { type: 'reset' }
  | { type: 'unknown'; raw: string };

export function workerHelpText(): string {
  return [
    '可用命令：',
    '/status 查看当前任务状态',
    '/reset 重置当前微信会话对应的 Claude 会话',
    '/echo 你好 做连通性测试',
    '/help 查看帮助'
  ].join('\n');
}

export function parseWorkerCommand(text: string): WorkerCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) {
    return null;
  }

  const [command, ...rest] = trimmed.split(/\s+/);
  switch (command) {
    case '/help':
      return { type: 'help' };
    case '/echo':
      return { type: 'echo', text: rest.join(' ') };
    case '/status':
      return { type: 'status' };
    case '/reset':
      return { type: 'reset' };
    default:
      return { type: 'unknown', raw: command };
  }
}
