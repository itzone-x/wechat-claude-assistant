import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { spawnSync } from 'node:child_process';

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  headers: Pick<Headers, 'get'>;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

export interface LookupAddressLike {
  address: string;
  family: number;
}

export type LookupLike = (
  hostname: string,
  options: { all: true; verbatim: true }
) => Promise<LookupAddressLike[]>;

export type FetchLike = (
  input: string | URL,
  init?: RequestInit
) => Promise<FetchResponseLike>;

export const WEB_FETCH_TIMEOUT_MS = 10_000;
const CURL_FETCH_TIMEOUT_SECONDS = Math.ceil(WEB_FETCH_TIMEOUT_MS / 1000);
export const WEB_FETCH_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

export function buildBypassProxyEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    HTTP_PROXY: '',
    HTTPS_PROXY: '',
    ALL_PROXY: '',
    http_proxy: '',
    https_proxy: '',
    all_proxy: ''
  };
}

export function prefersProxyBypass(baseEnv: NodeJS.ProcessEnv = process.env): boolean {
  return /^(1|true|yes)$/i.test(baseEnv.WECHAT_AGENT_BYPASS_PROXY || '');
}

export function buildNetworkEnvCandidates(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv[] {
  const inherited = { ...baseEnv };
  const bypass = buildBypassProxyEnv(baseEnv);
  const sameProxySettings = [
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'ALL_PROXY',
    'http_proxy',
    'https_proxy',
    'all_proxy'
  ].every((key) => (inherited[key] || '') === (bypass[key] || ''));

  if (sameProxySettings) {
    return [inherited];
  }

  return prefersProxyBypass(baseEnv)
    ? [bypass, inherited]
    : [inherited, bypass];
}

export function buildWebFetchInit(url: string): RequestInit {
  let referer = url;
  try {
    referer = new URL(url).origin;
  } catch {
    referer = url;
  }

  return {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      Referer: referer,
      'User-Agent': WEB_FETCH_USER_AGENT
    },
    signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(WEB_FETCH_TIMEOUT_MS)
      : undefined
  };
}

export interface RemoteBufferResult {
  buffer: Buffer;
  contentType: string | null;
  transport: 'fetch' | 'curl';
}

export interface CurlResultLike {
  error?: Error;
  status: number | null;
  stdout: string | Buffer;
  stderr: string | Buffer;
}

function isPrivateIpv4Host(host: string): boolean {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) {
    return false;
  }

  const [a, b] = [Number(match[1]), Number(match[2])];
  if (a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isPrivateIpv6Host(host: string): boolean {
  const lower = host.trim().toLowerCase();
  return lower === '::1'
    || lower.startsWith('fe80:')
    || lower.startsWith('fc')
    || lower.startsWith('fd');
}

function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.trim().toLowerCase();
  if (!lower) {
    return true;
  }

  if (
    lower === 'localhost'
    || lower.endsWith('.localhost')
    || lower.endsWith('.local')
    || lower === '0.0.0.0'
    || isPrivateIpv6Host(lower)
  ) {
    return true;
  }

  return isPrivateIpv4Host(lower);
}

function isBlockedResolvedAddress(address: string): boolean {
  const lower = address.trim().toLowerCase();
  if (!lower) {
    return true;
  }

  if (isIP(lower) === 4) {
    return isPrivateIpv4Host(lower);
  }

  if (isIP(lower) === 6) {
    return isPrivateIpv6Host(lower);
  }

  return false;
}

export async function assertSafeRemoteUrl(
  rawUrl: string,
  options?: {
    lookupImpl?: LookupLike;
  }
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`无效的远程链接: ${rawUrl}`);
  }

  if (!/^https?:$/i.test(parsed.protocol)) {
    throw new Error(`只支持 http/https 链接: ${rawUrl}`);
  }

  if (isBlockedHostname(parsed.hostname)) {
    throw new Error(`出于安全原因，禁止抓取本地或内网地址: ${rawUrl}`);
  }

  const lookupImpl = options?.lookupImpl || lookup;
  try {
    const resolved = await lookupImpl(parsed.hostname, { all: true, verbatim: true });
    const resolvedList = Array.isArray(resolved) ? resolved : [resolved];
    if (resolvedList.some((item: LookupAddressLike) => isBlockedResolvedAddress(item.address))) {
      throw new Error(`出于安全原因，禁止抓取本地或内网地址: ${rawUrl}`);
    }
  } catch (error) {
    if (error instanceof Error && /禁止抓取本地或内网地址/.test(error.message)) {
      throw error;
    }
  }

  return parsed;
}

export type CurlRunner = (
  command: string,
  args: string[],
  options: {
    encoding: BufferEncoding | null;
    maxBuffer: number;
    env: NodeJS.ProcessEnv;
  }
) => CurlResultLike;

function ensureValidDownloadResponse(response: FetchResponseLike, source: string): void {
  if (!response.ok) {
    throw new Error(`下载媒体失败: HTTP ${response.status} (${source})`);
  }
}

function defaultCurlRunner(
  command: string,
  args: string[],
  options: {
    encoding: BufferEncoding | null;
    maxBuffer: number;
    env: NodeJS.ProcessEnv;
  }
): CurlResultLike {
  return spawnSync(command, args, options);
}

export async function fetchRemoteBufferWithFallback(
  url: string,
  fetchImpl: FetchLike,
  options?: {
    baseEnv?: NodeJS.ProcessEnv;
    curlRunner?: CurlRunner;
  }
): Promise<RemoteBufferResult> {
  try {
    const response = await fetchImpl(url, buildWebFetchInit(url));
    ensureValidDownloadResponse(response, url);
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get('content-type'),
      transport: 'fetch'
    };
  } catch (fetchError) {
    const referer = (() => {
      try {
        return new URL(url).origin;
      } catch {
        return url;
      }
    })();

    const runner = options?.curlRunner || defaultCurlRunner;
    let lastAttempt: CurlResultLike | null = null;

    for (const env of buildNetworkEnvCandidates(options?.baseEnv || process.env)) {
      const attempt = runner('/usr/bin/curl', [
        '-fsSL',
        '--max-time',
        String(CURL_FETCH_TIMEOUT_SECONDS),
        '-A',
        WEB_FETCH_USER_AGENT,
        '-H',
        'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8',
        '-e',
        referer,
        url
      ], {
        encoding: null,
        maxBuffer: 20 * 1024 * 1024,
        env
      });

      lastAttempt = attempt;
      if (!attempt.error && attempt.status === 0 && attempt.stdout) {
        const stdout = attempt.stdout;
        return {
          buffer: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout),
          contentType: 'text/html',
          transport: 'curl'
        };
      }
    }

    if (lastAttempt?.error) {
      throw lastAttempt.error;
    }

    throw fetchError;
  }
}
