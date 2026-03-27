export interface GitHubRepo {
  owner: string;
  repo: string;
}

export interface GitHubReleasePayload {
  tag_name: string;
  target_commitish: string;
  name: string;
  body: string;
  draft: boolean;
  prerelease: boolean;
  generate_release_notes: boolean;
}

export interface ParsedReleaseMarkdown {
  name: string;
  body: string;
}

export function parseGitHubRepo(remoteUrl: string): GitHubRepo {
  const trimmed = remoteUrl.trim();
  let match = trimmed.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (match) {
    return { owner: match[1], repo: match[2] };
  }

  match = trimmed.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (match) {
    return { owner: match[1], repo: match[2] };
  }

  throw new Error(`无法从 remote URL 解析 GitHub 仓库: ${remoteUrl}`);
}

export function parseReleaseMarkdown(markdown: string): ParsedReleaseMarkdown {
  const lines = markdown.trim().split(/\r?\n/);
  const firstLine = lines[0]?.trim();
  if (!firstLine?.startsWith('# ')) {
    throw new Error('GitHub Release 文案第一行必须是一级标题，例如: # v0.1.1 · Stability Update');
  }

  const name = firstLine.slice(2).trim();
  const body = lines.slice(1).join('\n').trim();
  return { name, body };
}

export function buildGitHubReleasePayload(tag: string, targetCommitish: string, markdown: string): GitHubReleasePayload {
  const parsed = parseReleaseMarkdown(markdown);
  return {
    tag_name: tag,
    target_commitish: targetCommitish,
    name: parsed.name,
    body: parsed.body,
    draft: false,
    prerelease: false,
    generate_release_notes: false,
  };
}

export function versionFromTag(tag: string): string {
  return tag.startsWith('v') ? tag.slice(1) : tag;
}

export function releaseMarkdownPathForTag(tag: string): string {
  return `docs/releases/github-release-v${versionFromTag(tag)}.md`;
}
