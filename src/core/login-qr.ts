import { spawn } from 'node:child_process';
import { chmod, writeFile } from 'node:fs/promises';

import {
  DEFAULT_BASE_URL,
  getStatePaths
} from './config.js';
import { fetchQRCode, pollQRCodeStatus, randomWechatUin } from './ilink-api.js';
import { ensureParentDir, readJsonFile, writeJsonFile } from './state.js';
import { addPairedUser } from './pairing.js';
import type { AccountData } from '../types/ilink.js';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replaceAll('"', '&quot;');
}

function normalizeQrSource(qrContent: string): string {
  const trimmed = qrContent.trim();
  if (!trimmed) {
    return trimmed;
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:')) {
    return trimmed;
  }

  return `data:image/png;base64,${trimmed}`;
}

function isRemoteQrPageUrl(qrContent: string): boolean {
  const trimmed = qrContent.trim();
  return trimmed.startsWith('http://') || trimmed.startsWith('https://');
}

function isLikelySvg(qrContent: string): boolean {
  const trimmed = qrContent.trim();
  return /^<svg[\s>]/i.test(trimmed)
    || (trimmed.startsWith('<?xml') && trimmed.includes('<svg'));
}

function isLikelyTextQr(qrContent: string): boolean {
  const trimmed = qrContent.trimEnd();
  if (!trimmed.includes('\n')) {
    return false;
  }

  const lines = trimmed.split(/\r?\n/).filter(Boolean);
  if (lines.length < 8) {
    return false;
  }

  return /[█▀▄▌▐▓▒░]/u.test(trimmed)
    || /^[\u2580-\u259f\s\r\n]+$/u.test(trimmed);
}

export function buildQrHtml(qrContent: string): string {
  const trimmed = qrContent.trim();
  let qrMarkup = '<p style="color: #b42318;">接口返回了空二维码内容，请重试登录。</p>';

  if (trimmed) {
    if (isRemoteQrPageUrl(trimmed)) {
      const escapedUrl = escapeHtmlAttribute(trimmed);
      qrMarkup = [
        '<p>接口返回的是远程二维码页面链接，不是静态图片。</p>',
        `<p><a href="${escapedUrl}" target="_blank" rel="noreferrer">打开微信二维码页面</a></p>`,
        `<p style="word-break: break-all; color: #475467;">${escapeHtml(trimmed)}</p>`,
        `<script>window.location.replace(${JSON.stringify(trimmed)});</script>`
      ].join('');
    } else if (isLikelyTextQr(trimmed)) {
      qrMarkup = [
        '<p>接口返回的是字符二维码。如果浏览器里不好扫，请直接在终端里查看下面的字符码。</p>',
        `<pre style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; line-height: 1; font-size: 8px; background: #fff; color: #000; padding: 12px; overflow: auto; border: 1px solid #d0d5dd; border-radius: 8px;">${escapeHtml(trimmed)}</pre>`
      ].join('');
    } else if (isLikelySvg(trimmed)) {
      qrMarkup = `<div style="max-width: 360px;">${trimmed}</div>`;
    } else {
      const url = normalizeQrSource(trimmed);
      qrMarkup = `<img src="${escapeHtmlAttribute(url)}" alt="微信二维码" style="max-width: 320px; width: 100%; height: auto;" />`;
    }
  }

  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head><meta charset="utf-8"><title>微信登录二维码</title></head>',
    '<body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 24px;">',
    '<h1>微信登录</h1>',
    '<p>请使用微信扫描下面的二维码，并在微信中点确认。</p>',
    qrMarkup,
    '</body>',
    '</html>'
  ].join('');
}

export function buildConsoleQrPreview(qrContent: string): string | null {
  const trimmed = qrContent.trimEnd();
  return isLikelyTextQr(trimmed) ? trimmed : null;
}

export function resolveQrOpenTarget(
  qrContent: string,
  fallbackPagePath: string
): string {
  return isRemoteQrPageUrl(qrContent) ? qrContent.trim() : fallbackPagePath;
}

function openCommandForPlatform(): string | null {
  switch (process.platform) {
    case 'darwin':
      return 'open';
    case 'win32':
      return 'start';
    default:
      return 'xdg-open';
  }
}

async function writeQrPage(qrContent: string): Promise<string> {
  const tempPath = `${getStatePaths().stateDir}/login-qrcode.html`;
  await ensureParentDir(tempPath);
  await writeFile(tempPath, buildQrHtml(qrContent), 'utf-8');
  return tempPath;
}

async function tryOpenQrPage(pagePath: string): Promise<boolean> {
  const command = openCommandForPlatform();
  if (!command) {
    return false;
  }

  return await new Promise<boolean>((resolve) => {
    const args = process.platform === 'win32' ? ['/c', 'start', '', pagePath] : [pagePath];
    const child = spawn(
      process.platform === 'win32' ? 'cmd' : command,
      args,
      {
        detached: true,
        stdio: 'ignore'
      }
    );

    child.on('error', () => resolve(false));
    child.on('spawn', () => {
      child.unref();
      resolve(true);
    });
  });
}

function toAccountData(raw: Partial<AccountData> | null): AccountData | null {
  if (!raw?.token) {
    return null;
  }

  return {
    token: raw.token,
    uin: raw.uin || randomWechatUin(),
    baseUrl: raw.baseUrl || DEFAULT_BASE_URL,
    accountId: raw.accountId,
    userId: raw.userId,
    savedAt: raw.savedAt || new Date().toISOString()
  };
}

export async function loadSavedAccount(): Promise<AccountData | null> {
  return loadSavedAccountWithOptions();
}

export interface LoadSavedAccountOptions {
  migrateLegacy?: boolean;
}

export async function loadSavedAccountWithOptions(
  options: LoadSavedAccountOptions = {}
): Promise<AccountData | null> {
  const { migrateLegacy = true } = options;
  const paths = getStatePaths();

  const local = toAccountData(
    await readJsonFile<Partial<AccountData> | null>(paths.accountPath, null)
  );
  if (local) {
    return local;
  }

  const legacy = toAccountData(
    await readJsonFile<Partial<AccountData> | null>(paths.legacyAccountPath, null)
  );
  if (!legacy) {
    return null;
  }

  if (migrateLegacy) {
    await saveAccount(legacy);
  }
  return legacy;
}

export async function saveAccount(account: AccountData): Promise<void> {
  const paths = getStatePaths();
  await writeJsonFile(paths.accountPath, account);

  try {
    await chmod(paths.accountPath, 0o600);
  } catch {}
}

export async function isLoggedIn(): Promise<boolean> {
  return (await loadSavedAccount()) !== null;
}

export async function performLogin(
  log: (message: string) => void = console.log
): Promise<AccountData> {
  log('现在开始连接微信。');
  log('正在获取二维码，请稍候...\n');

  const qr = await fetchQRCode();
  const consolePreview = buildConsoleQrPreview(qr.qrcode_img_content);
  if (consolePreview) {
    log('检测到字符二维码，终端预览如下：\n');
    log(consolePreview);
    log('');
  }
  const qrPagePath = await writeQrPage(qr.qrcode_img_content);
  const qrOpenTarget = resolveQrOpenTarget(qr.qrcode_img_content, qrPagePath);
  const opened = await tryOpenQrPage(qrOpenTarget).catch(() => false);
  if (opened) {
    log('已尝试在浏览器中打开微信二维码页面。');
  } else {
    log(`请手动打开这个文件查看二维码：${qrPagePath}`);
    if (qrOpenTarget !== qrPagePath) {
      log(`或直接手动打开这个链接：${qrOpenTarget}`);
    }
  }
  log(`二维码页面文件：${qrPagePath}`);
  if (qrOpenTarget !== qrPagePath) {
    log(`二维码直达链接：${qrOpenTarget}`);
  }
  log('\n扫码后，请在微信里点确认。\n');

  const deadline = Date.now() + 8 * 60_000;
  let hasPrintedScanned = false;

  while (Date.now() < deadline) {
    const status = await pollQRCodeStatus(qr.qrcode);

    switch (status.status) {
      case 'scaned':
        if (!hasPrintedScanned) {
          log('已扫码，请回到微信完成确认。');
          hasPrintedScanned = true;
        }
        break;
      case 'expired':
        throw new Error('二维码已过期，请重新运行登录。');
      case 'confirmed': {
        if (!status.bot_token) {
          throw new Error('登录已确认，但没有收到可用 token。');
        }

        const account: AccountData = {
          token: status.bot_token,
          uin: randomWechatUin(),
          baseUrl: status.baseurl || DEFAULT_BASE_URL,
          accountId: status.ilink_bot_id,
          userId: status.ilink_user_id,
          savedAt: new Date().toISOString()
        };

        await saveAccount(account);

        if (account.userId) {
          await addPairedUser(account.userId);
        }

        log('✅ 微信连接成功。');
        if (account.userId) {
          log(`默认已将当前微信用户加入授权列表：${account.userId}`);
        }
        return account;
      }
      default:
        break;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error('登录超时，请重新运行登录。');
}
