import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

import type { AccountData, WorkerMessage } from '../types/ilink.js';
import {
  DEFAULT_BASE_URL,
  DEFAULT_CHANNEL_VERSION,
  getStatePaths
} from './config.js';
import { loadSavedAccount } from './login-qr.js';
import { resolveMessageAttachments } from './media.js';
import { readJsonFile, readTextFile, writeJsonFile, writeTextFile } from './state.js';

export type WechatBridgeMode = 'worker' | 'channels';

export interface SyncState {
  mode: WechatBridgeMode;
  syncBufPath: string;
}

export interface WechatBridge {
  init(): Promise<void>;
  pollMessages(): Promise<WorkerMessage[]>;
  sendReply(text: string, toUserId?: string, contextToken?: string): Promise<unknown>;
}

interface MessageDedupSnapshot {
  exact: Record<string, number>;
  semantic: Record<string, number>;
}

interface WechatRequestPayload {
  get_updates_buf?: string;
  base_info: {
    channel_version: string;
  };
  msg?: {
    from_user_id: string;
    to_user_id: string;
    client_id: string;
    message_type: number;
    message_state: number;
    item_list: Array<{
      type: number;
      text_item: {
        text: string;
      };
    }>;
    context_token: string;
  };
}

function randomWechatUin(): string {
  const uint32 = randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), 'utf-8').toString('base64');
}

export function createSyncState(
  stateDir: string,
  mode: WechatBridgeMode
): SyncState {
  return {
    mode,
    syncBufPath: join(stateDir, 'runtime', `${mode}.sync_buf.txt`)
  };
}

function getSyncState(mode: WechatBridgeMode): SyncState {
  const paths = getStatePaths();
  return createSyncState(paths.stateDir, mode);
}

function buildHeaders(
  account: AccountData | null,
  body?: string
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'AuthorizationType': 'ilink_bot_token',
    'X-WECHAT-UIN': account?.uin || randomWechatUin()
  };

  if (body) {
    headers['Content-Length'] = String(Buffer.byteLength(body, 'utf-8'));
  }

  if (account?.token.trim()) {
    headers['Authorization'] = `Bearer ${account.token.trim()}`;
  }

  return headers;
}

function summarizeItemList(itemList: unknown[]): string {
  return itemList.map((item, index) => {
    if (!item || typeof item !== 'object') {
      return `#${index}:non-object`;
    }
    const record = item as Record<string, unknown>;
    const keys = Object.keys(record).slice(0, 8).join(',');
    const type = typeof record.type === 'number' || typeof record.type === 'string'
      ? String(record.type)
      : '?';
    return `#${index}:type=${type};keys=${keys}`;
  }).join(' | ');
}

function summarizeDedupRelevantContent(itemList: unknown[]): string {
  return itemList.map((item) => {
    if (!item || typeof item !== 'object') {
      return 'non-object';
    }

    const record = item as Record<string, unknown>;
    const text = typeof (record.text_item as any)?.text === 'string'
      ? String((record.text_item as any).text).trim()
      : '';
    const voiceText = typeof (record.voice_item as any)?.text === 'string'
      ? String((record.voice_item as any).text).trim()
      : '';
    const mediaEncrypt = typeof (record.image_item as any)?.media?.encrypt_query_param === 'string'
      ? String((record.image_item as any).media.encrypt_query_param).slice(0, 32)
      : typeof (record.voice_item as any)?.media?.encrypt_query_param === 'string'
        ? String((record.voice_item as any).media.encrypt_query_param).slice(0, 32)
        : '';

    return JSON.stringify({
      type: record.type,
      text,
      voiceText,
      mediaEncrypt,
      create: record.create_time_ms,
      update: record.update_time_ms
    });
  }).join('|');
}

function summarizeSemanticContent(itemList: unknown[]): string {
  return itemList.map((item) => {
    if (!item || typeof item !== 'object') {
      return 'non-object';
    }

    const record = item as Record<string, unknown>;
    const text = typeof (record.text_item as any)?.text === 'string'
      ? String((record.text_item as any).text).trim()
      : '';
    const voiceText = typeof (record.voice_item as any)?.text === 'string'
      ? String((record.voice_item as any).text).trim()
      : '';

    const mediaRecord = (record.image_item as any)?.media
      || (record.voice_item as any)?.media
      || record.image_item
      || record.voice_item
      || {};

    const mediaToken = typeof mediaRecord?.encrypt_query_param === 'string'
      ? String(mediaRecord.encrypt_query_param).slice(0, 64)
      : typeof mediaRecord?.pic_url === 'string'
        ? String(mediaRecord.pic_url).slice(0, 64)
        : typeof mediaRecord?.download_url === 'string'
          ? String(mediaRecord.download_url).slice(0, 64)
          : '';

    return JSON.stringify({
      type: record.type,
      text,
      voiceText,
      mediaToken
    });
  }).join('|');
}

export function buildWechatMessageDedupKey(msg: any): string {
  const fromUserId = String(msg?.from_user_id || '').trim();
  const contextToken = String(msg?.context_token || '').trim();
  const messageId = msg?.message_id;
  const seq = msg?.seq;
  const clientId = String(msg?.client_id || '').trim();
  const createdAt = String(msg?.create_time_ms || '');
  const updatedAt = String(msg?.update_time_ms || '');
  const itemList = Array.isArray(msg?.item_list) ? msg.item_list : [];

  if (messageId !== undefined && messageId !== null && String(messageId).trim()) {
    return `mid:${messageId}`;
  }

  if (seq !== undefined && seq !== null && String(seq).trim()) {
    return `seq:${seq}:${fromUserId}:${contextToken}`;
  }

  if (clientId) {
    return `client:${clientId}:${fromUserId}:${contextToken}`;
  }

  return [
    'fallback',
    fromUserId,
    contextToken,
    createdAt,
    updatedAt,
    summarizeDedupRelevantContent(itemList)
  ].join(':');
}

function hasStableWechatMessageIdentity(msg: any): boolean {
  const messageId = msg?.message_id;
  const seq = msg?.seq;
  const clientId = String(msg?.client_id || '').trim();

  return Boolean(
    (messageId !== undefined && messageId !== null && String(messageId).trim())
    || (seq !== undefined && seq !== null && String(seq).trim())
    || clientId
  );
}

export function buildWechatMessageSemanticKey(msg: any): string {
  const fromUserId = String(msg?.from_user_id || '').trim();
  const contextToken = String(msg?.context_token || '').trim();
  const itemList = Array.isArray(msg?.item_list) ? msg.item_list : [];

  return [
    'semantic',
    fromUserId,
    contextToken,
    summarizeSemanticContent(itemList)
  ].join(':');
}

export class MessageDeduper {
  private readonly recentExact = new Map<string, number>();
  private readonly recentSemantic = new Map<string, number>();

  constructor(
    private readonly ttlMs = 60_000,
    private readonly semanticTtlMs = 8_000,
    snapshot?: MessageDedupSnapshot
  ) {
    if (snapshot) {
      for (const [key, timestamp] of Object.entries(snapshot.exact || {})) {
        this.recentExact.set(key, timestamp);
      }
      for (const [key, timestamp] of Object.entries(snapshot.semantic || {})) {
        this.recentSemantic.set(key, timestamp);
      }
    }
  }

  snapshot(now = Date.now()): MessageDedupSnapshot {
    this.prune(now);
    return {
      exact: Object.fromEntries(this.recentExact),
      semantic: Object.fromEntries(this.recentSemantic)
    };
  }

  private prune(now: number): void {
    for (const [existingKey, timestamp] of this.recentExact) {
      if (now - timestamp > this.ttlMs) {
        this.recentExact.delete(existingKey);
      }
    }

    for (const [existingKey, timestamp] of this.recentSemantic) {
      if (now - timestamp > this.semanticTtlMs) {
        this.recentSemantic.delete(existingKey);
      }
    }
  }

  seen(message: any, now = Date.now()): boolean {
    const exactKey = buildWechatMessageDedupKey(message);
    const semanticKey = buildWechatMessageSemanticKey(message);
    const useSemanticKey = !hasStableWechatMessageIdentity(message);

    this.prune(now);

    const exactPrevious = this.recentExact.get(exactKey);
    const semanticPrevious = useSemanticKey
      ? this.recentSemantic.get(semanticKey)
      : undefined;

    this.recentExact.set(exactKey, now);
    if (useSemanticKey) {
      this.recentSemantic.set(semanticKey, now);
    }

    return (
      (exactPrevious !== undefined && now - exactPrevious <= this.ttlMs)
      || (semanticPrevious !== undefined && now - semanticPrevious <= this.semanticTtlMs)
    );
  }
}

export function extractWechatMessageText(itemList: unknown[]): string {
  const parts: string[] = [];

  for (const item of itemList) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const record = item as Record<string, unknown>;
    const text = typeof (record.text_item as any)?.text === 'string'
      ? String((record.text_item as any).text).trim()
      : '';
    const voiceText = typeof (record.voice_item as any)?.text === 'string'
      ? String((record.voice_item as any).text).trim()
      : '';

    if (text) {
      parts.push(text);
    }
    if (voiceText) {
      parts.push(voiceText);
    }
  }

  return parts.join('\n').trim();
}

class ILinkWechatBridge implements WechatBridge {
  private account: AccountData | null = null;
  private syncBuf = '';
  private latestContextToken = '';
  private latestFromUserId = '';
  private readonly syncState: SyncState;
  private messageDeduper = new MessageDeduper();

  constructor(mode: WechatBridgeMode) {
    this.syncState = getSyncState(mode);
  }

  async init(): Promise<void> {
    this.account = await loadSavedAccount();
    if (!this.account) {
      throw new Error('尚未连接微信，请先运行 install 或 login。');
    }

    this.syncBuf = await readTextFile(this.syncState.syncBufPath, '');
    const dedupSnapshot = await readJsonFile<MessageDedupSnapshot>(
      getStatePaths().messageDedupPath,
      { exact: {}, semantic: {} }
    );
    this.messageDeduper = new MessageDeduper(60_000, 8_000, dedupSnapshot);
  }

  async pollMessages(): Promise<WorkerMessage[]> {
    const data = await this.request('/ilink/bot/getupdates', {
      get_updates_buf: this.syncBuf,
      base_info: { channel_version: DEFAULT_CHANNEL_VERSION }
    });

    if (typeof data?.get_updates_buf === 'string' && data.get_updates_buf !== this.syncBuf) {
      this.syncBuf = data.get_updates_buf;
      await writeTextFile(this.syncState.syncBufPath, this.syncBuf);
    }

    const messages: WorkerMessage[] = [];
    let dedupChanged = false;
    if (!Array.isArray(data?.msgs)) {
      return messages;
    }

    for (const msg of data.msgs) {
      if (msg?.message_type === 2) {
        continue;
      }

      const dedupKey = buildWechatMessageDedupKey(msg);
      const semanticKey = buildWechatMessageSemanticKey(msg);
      const duplicated = this.messageDeduper.seen(msg);
      dedupChanged = true;
      if (duplicated) {
        console.error(
          `[worker] 忽略重复消息: key=${dedupKey}; semantic=${semanticKey}`
        );
        continue;
      }

      const fromUserId = String(msg.from_user_id || '').trim();
      const contextToken = String(msg.context_token || '').trim();
      if (!fromUserId || !contextToken) {
        continue;
      }

      const itemList = Array.isArray(msg?.item_list) ? msg.item_list : [];
      const text = extractWechatMessageText(itemList);
      const attachments = await resolveMessageAttachments({
        text,
        itemList,
        targetDir: getStatePaths().attachmentsDir,
        baseUrl: this.account?.baseUrl
      });
      if (!text && attachments.length === 0) {
        console.error(
          `[worker] 忽略一条未识别消息: from=${fromUserId}; items=${summarizeItemList(itemList)}`
        );
        continue;
      }

      if (attachments.length > 0) {
        console.error(
          `[worker] 收到多模态消息: from=${fromUserId}; attachments=${attachments.length}; text=${text ? 'yes' : 'no'}`
        );
      }

      this.latestFromUserId = fromUserId;
      this.latestContextToken = contextToken;
      messages.push({
        fromUserId,
        text,
        contextToken,
        attachments
      });
    }

    if (dedupChanged) {
      await writeJsonFile(
        getStatePaths().messageDedupPath,
        this.messageDeduper.snapshot()
      );
    }

    return messages;
  }

  async sendReply(
    text: string,
    toUserId?: string,
    contextToken?: string
  ): Promise<unknown> {
    const resolvedContextToken = contextToken?.trim() || this.latestContextToken;
    const resolvedToUserId = toUserId?.trim() || this.latestFromUserId;

    if (!resolvedContextToken) {
      throw new Error('No context_token available');
    }

    if (!resolvedToUserId) {
      throw new Error('No to_user_id available');
    }

    const clientId = `claude-code-wechat:${Date.now()}-${randomBytes(4).toString('hex')}`;

    return await this.request('/ilink/bot/sendmessage', {
      msg: {
        from_user_id: '',
        to_user_id: resolvedToUserId,
        client_id: clientId,
        message_type: 2,
        message_state: 2,
        item_list: [{
          type: 1,
          text_item: { text }
        }],
        context_token: resolvedContextToken
      },
      base_info: { channel_version: DEFAULT_CHANNEL_VERSION }
    });
  }

  private async request(
    endpoint: string,
    body?: WechatRequestPayload
  ): Promise<any> {
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const headers = buildHeaders(this.account, bodyStr);
    const baseUrl = this.account?.baseUrl || DEFAULT_BASE_URL;

    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers,
      body: bodyStr
    });

    if (!response.ok) {
      throw new Error(`微信接口请求失败: HTTP ${response.status}`);
    }

    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (data?.ret === -14) {
      throw new Error('微信登录已失效，请重新运行 login。');
    }
    if (typeof data?.ret === 'number' && data.ret !== 0 && endpoint !== '/ilink/bot/getupdates') {
      throw new Error(data.errmsg || `微信接口返回错误 ret=${data.ret}`);
    }

    return data;
  }
}

export function createWechatBridge(mode: WechatBridgeMode): WechatBridge {
  return new ILinkWechatBridge(mode);
}
