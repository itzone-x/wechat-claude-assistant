import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  buildGitHubReleasePayload,
  parseGitHubRepo,
  releaseMarkdownPathForTag,
  versionFromTag,
} from './core/github-release.js';
import { assertManualVerificationApproved, manualVerificationPathForTag } from './core/release-gate.js';

interface PublishOptions {
  tag?: string;
  repo?: string;
  notes?: string;
  dryRun: boolean;
}

interface GitHubReleaseResponse {
  id: number;
  html_url: string;
  tag_name: string;
}

function parseArgs(argv: string[]): PublishOptions {
  const options: PublishOptions = { dryRun: false };

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    const next = argv[i + 1];

    if (current === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (current === '--tag' && next) {
      options.tag = next;
      i += 1;
      continue;
    }
    if (current === '--repo' && next) {
      options.repo = next;
      i += 1;
      continue;
    }
    if (current === '--notes' && next) {
      options.notes = next;
      i += 1;
      continue;
    }
    throw new Error(`不支持的参数: ${current}`);
  }

  return options;
}

function readPackageVersion(rootDir: string): string {
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')) as { version?: string };
  if (!packageJson.version) {
    throw new Error('package.json 中没有 version');
  }
  return packageJson.version;
}

function resolveTag(rootDir: string, explicitTag?: string): string {
  if (explicitTag) {
    return explicitTag;
  }
  return `v${readPackageVersion(rootDir)}`;
}

function resolveRepo(rootDir: string, explicitRepo?: string): { owner: string; repo: string } {
  if (explicitRepo) {
    const [owner, repo] = explicitRepo.split('/');
    if (!owner || !repo) {
      throw new Error(`不支持的仓库格式: ${explicitRepo}，应为 owner/repo`);
    }
    return { owner, repo };
  }

  const remoteUrl = execFileSync('git', ['remote', 'get-url', 'origin'], {
    cwd: rootDir,
    encoding: 'utf8',
  }).trim();

  return parseGitHubRepo(remoteUrl);
}

function resolveNotesPath(rootDir: string, tag: string, explicitNotes?: string): string {
  return path.join(rootDir, explicitNotes ?? releaseMarkdownPathForTag(tag));
}

async function githubRequest<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.headers ?? {}),
    },
  });

  if (response.status === 404) {
    throw Object.assign(new Error('NOT_FOUND'), { status: 404 });
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API 请求失败: ${response.status} ${text}`);
  }

  return (await response.json()) as T;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const rootDir = process.cwd();
  const token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  if (!token) {
    throw new Error('缺少 GITHUB_PERSONAL_ACCESS_TOKEN 环境变量');
  }

  const tag = resolveTag(rootDir, options.tag);
  const repo = resolveRepo(rootDir, options.repo);
  const notesPath = resolveNotesPath(rootDir, tag, options.notes);
  const verificationPath = path.join(rootDir, manualVerificationPathForTag(tag));

  if (!fs.existsSync(notesPath)) {
    throw new Error(`未找到 GitHub Release 文案: ${notesPath}`);
  }

  const markdown = fs.readFileSync(notesPath, 'utf8');
  const payload = buildGitHubReleasePayload(tag, 'main', markdown);

  if (options.dryRun) {
    process.stdout.write(
      JSON.stringify(
        {
          repo: `${repo.owner}/${repo.repo}`,
          tag,
          notesPath,
          verificationPath,
          payload,
        },
        null,
        2,
      ),
    );
    return;
  }

  assertManualVerificationApproved(rootDir, tag);

  const existingUrl = `https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/tags/${tag}`;
  let result: GitHubReleaseResponse;

  try {
    const existing = await githubRequest<GitHubReleaseResponse>(existingUrl, token);
    result = await githubRequest<GitHubReleaseResponse>(
      `https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/${existing.id}`,
      token,
      {
        method: 'PATCH',
        body: JSON.stringify({
          name: payload.name,
          body: payload.body,
          draft: payload.draft,
          prerelease: payload.prerelease,
          target_commitish: payload.target_commitish,
        }),
      },
    );
    process.stdout.write(`已更新 GitHub Release: ${result.html_url}`);
    return;
  } catch (error) {
    const status = typeof error === 'object' && error !== null ? (error as { status?: number }).status : undefined;
    if (status !== 404) {
      throw error;
    }
  }

  result = await githubRequest<GitHubReleaseResponse>(
    `https://api.github.com/repos/${repo.owner}/${repo.repo}/releases`,
    token,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );

  process.stdout.write(`已创建 GitHub Release: ${result.html_url}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
