import { randomBytes } from 'node:crypto';

import {
  DEFAULT_BASE_URL,
  DEFAULT_BOT_TYPE
} from './config.js';
import type { QRCodeResponse, QRStatusResponse } from '../types/ilink.js';

export function randomWechatUin(): string {
  const uint32 = randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), 'utf-8').toString('base64');
}

export function buildHeaders(
  token?: string,
  body?: string
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'AuthorizationType': 'ilink_bot_token',
    'X-WECHAT-UIN': randomWechatUin()
  };

  if (body) {
    headers['Content-Length'] = String(Buffer.byteLength(body, 'utf-8'));
  }

  if (token?.trim()) {
    headers['Authorization'] = `Bearer ${token.trim()}`;
  }

  return headers;
}

export async function fetchQRCode(
  baseUrl = DEFAULT_BASE_URL,
  botType = DEFAULT_BOT_TYPE
): Promise<QRCodeResponse> {
  const response = await fetch(
    `${baseUrl}/ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`
  );

  if (!response.ok) {
    throw new Error(`获取二维码失败: HTTP ${response.status}`);
  }

  return await response.json() as QRCodeResponse;
}

export async function pollQRCodeStatus(
  qrcode: string,
  baseUrl = DEFAULT_BASE_URL
): Promise<QRStatusResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 35_000);

  try {
    const response = await fetch(
      `${baseUrl}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
      {
        headers: { 'iLink-App-ClientVersion': '1' },
        signal: controller.signal
      }
    );

    if (!response.ok) {
      throw new Error(`轮询二维码状态失败: HTTP ${response.status}`);
    }

    return await response.json() as QRStatusResponse;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { status: 'wait' };
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}
