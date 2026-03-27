import type { WorkerMessage } from '../../types/ilink.js';

const PERMISSION_REPLY_RE = /^\s*(yes|y|no|n)\s+([a-z0-9]{5})\s*$/i;

export interface PermissionRequestParams {
  request_id: string;
  tool_name: string;
  input_preview: string;
  description: string;
}

export interface PermissionDecision {
  requestId: string;
  behavior: 'allow' | 'deny';
}

export interface ChatContext {
  chatId: string;
  contextToken: string;
  senderId: string;
  updatedAt: string;
}

export interface ChannelNotificationPayload {
  method: 'notifications/claude/channel';
  params: {
    message: {
      role: 'user';
      content: Array<{ type: 'text'; text: string }>;
    };
    metadata: {
      chat_id: string;
      sender_id: string;
      context_token: string;
    };
  };
}

export interface PermissionNotificationPayload {
  method: 'notifications/claude/channel/permission';
  params: {
    request_id: string;
    behavior: 'allow' | 'deny';
  };
}

export interface ChannelReplyResult {
  content: Array<{ type: 'text'; text: string }>;
}

interface WechatChannelBridgeDeps {
  isPairedUser(userId: string): Promise<boolean>;
  sendReply(text: string, toUserId?: string, contextToken?: string): Promise<unknown>;
  emitNotification(
    notification: ChannelNotificationPayload | PermissionNotificationPayload
  ): Promise<void>;
}

export function buildInstructions(): string {
  return [
    'This channel forwards paired WeChat user messages into Claude Code.',
    'Inbound messages arrive through channel notifications with metadata including chat_id, sender_id, and context_token.',
    'When replying, always call the `wechat_reply` tool.',
    'Pass the same `chat_id` from the incoming channel metadata.',
    'If `context_token` is available in the channel metadata, pass it back as well to avoid replying to the wrong thread.',
    'If the user is approving a tool request from WeChat, they will reply with `yes <request_id>` or `no <request_id>`.'
  ].join(' ');
}

export function parsePermissionReply(text: string): PermissionDecision | null {
  const match = PERMISSION_REPLY_RE.exec(text.trim());
  if (!match) {
    return null;
  }

  const [, verdict, requestId] = match;
  return {
    requestId,
    behavior: verdict.toLowerCase().startsWith('y') ? 'allow' : 'deny'
  };
}

export function buildPermissionPrompt(params: PermissionRequestParams): string {
  return [
    'Claude Code 请求执行一个工具操作：',
    `工具: ${params.tool_name}`,
    `说明: ${params.description}`,
    params.input_preview ? `参数预览: ${params.input_preview}` : '',
    '',
    `如需允许，请回复: yes ${params.request_id}`,
    `如需拒绝，请回复: no ${params.request_id}`
  ].filter(Boolean).join('\n');
}

export function buildChannelNotification(message: WorkerMessage): ChannelNotificationPayload {
  const parts: string[] = [];
  if (message.text.trim()) {
    parts.push(message.text.trim());
  }
  const attachments = message.attachments || [];
  if (attachments.length > 0) {
    parts.push('');
    parts.push(`用户还发送了 ${attachments.length} 个附件，请结合这些输入一起理解。`);
    attachments.forEach((attachment, index) => {
      const label = attachment.type === 'image'
        ? '图片'
        : attachment.type === 'audio'
          ? '语音'
          : attachment.type === 'webpage'
            ? '网页'
            : '文档';
      const originalUrl = attachment.originalUrl ? `，原始链接: ${attachment.originalUrl}` : '';
      const title = attachment.title ? `，标题: ${attachment.title}` : '';
      parts.push(`${label} ${index + 1}: ${attachment.filePath}${title}${originalUrl}`);
    });
  }

  return {
    method: 'notifications/claude/channel',
    params: {
      message: {
        role: 'user',
        content: [{
          type: 'text',
          text: parts.filter(Boolean).join('\n') || '用户发送了一条空白消息。'
        }]
      },
      metadata: {
        chat_id: message.fromUserId,
        sender_id: message.fromUserId,
        context_token: message.contextToken
      }
    }
  };
}

export class WechatChannelBridge {
  private readonly chatContextMap = new Map<string, ChatContext>();
  private readonly pendingPermissionChatMap = new Map<string, ChatContext>();
  private latestChatContext: ChatContext | null = null;

  constructor(private readonly deps: WechatChannelBridgeDeps) {}

  async handleWechatMessage(message: WorkerMessage): Promise<void> {
    const allowed = await this.deps.isPairedUser(message.fromUserId);
    if (!allowed) {
      return;
    }

    const context: ChatContext = {
      chatId: message.fromUserId,
      contextToken: message.contextToken,
      senderId: message.fromUserId,
      updatedAt: new Date().toISOString()
    };
    this.chatContextMap.set(message.fromUserId, context);
    this.latestChatContext = context;

    const decision = parsePermissionReply(message.text);
    if (decision) {
      await this.handlePermissionDecision(message, decision);
      return;
    }

    await this.deps.emitNotification(buildChannelNotification(message));
  }

  async handlePermissionRequest(params: PermissionRequestParams): Promise<boolean> {
    const target = this.latestChatContext;
    if (!target) {
      return false;
    }

    this.pendingPermissionChatMap.set(params.request_id, target);
    await this.deps.sendReply(
      buildPermissionPrompt(params),
      target.chatId,
      target.contextToken
    );
    return true;
  }

  async handleReplyTool(args: {
    chat_id?: string;
    text?: string;
    context_token?: string;
  }): Promise<ChannelReplyResult> {
    const chatId = args.chat_id?.trim();
    const text = args.text?.trim();
    const contextToken = args.context_token?.trim()
      || (chatId ? this.chatContextMap.get(chatId)?.contextToken : undefined);

    if (!chatId) {
      return {
        content: [{ type: 'text', text: '缺少 chat_id，无法路由微信回复。' }]
      };
    }

    if (!text) {
      return {
        content: [{ type: 'text', text: '缺少 text，无法发送空回复。' }]
      };
    }

    try {
      const result: any = await this.deps.sendReply(text, chatId, contextToken);
      if (result?.ret && result.ret !== 0) {
        return {
          content: [{
            type: 'text',
            text: `发送失败 (ret=${result.ret}): ${result.errmsg || '未知错误'}`
          }]
        };
      }

      return {
        content: [{ type: 'text', text: `已发送到微信会话 ${chatId}` }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `发送失败: ${error instanceof Error ? error.message : String(error)}`
        }]
      };
    }
  }

  getLatestChatContext(): ChatContext | null {
    return this.latestChatContext;
  }

  getPendingPermissionContext(requestId: string): ChatContext | null {
    return this.pendingPermissionChatMap.get(requestId) || null;
  }

  private async handlePermissionDecision(
    message: WorkerMessage,
    decision: PermissionDecision
  ): Promise<void> {
    const pending = this.pendingPermissionChatMap.get(decision.requestId);
    if (!pending) {
      await this.deps.sendReply(
        `审批码 ${decision.requestId} 当前不存在或已过期。`,
        message.fromUserId,
        message.contextToken
      );
      return;
    }

    if (pending && pending.chatId !== message.fromUserId) {
      await this.deps.sendReply(
        `审批码 ${decision.requestId} 不属于当前微信会话，已忽略。`,
        message.fromUserId,
        message.contextToken
      );
      return;
    }

    await this.deps.emitNotification({
      method: 'notifications/claude/channel/permission',
      params: {
        request_id: decision.requestId,
        behavior: decision.behavior
      }
    });

    this.pendingPermissionChatMap.delete(decision.requestId);
    await this.deps.sendReply(
      decision.behavior === 'allow'
        ? `已记录审批: yes ${decision.requestId}`
        : `已记录审批: no ${decision.requestId}`,
      message.fromUserId,
      message.contextToken
    );
  }
}
