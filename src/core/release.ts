export type ReleaseKind = 'patch' | 'minor' | 'major';

export interface ReleaseSection {
  heading: string;
  body: string;
}

export interface ParsedChangelog {
  preamble: string;
  unreleasedBody: string;
  releasedSections: ReleaseSection[];
}

const CHANGELOG_HEADING_REGEX = /^## \[(.+?)\](?: - (\d{4}-\d{2}-\d{2}))?\n/gm;

export function bumpVersion(currentVersion: string, kind: ReleaseKind): string {
  const match = currentVersion.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`不支持的版本号格式: ${currentVersion}`);
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);

  if (kind === 'major') {
    return `${major + 1}.0.0`;
  }
  if (kind === 'minor') {
    return `${major}.${minor + 1}.0`;
  }
  return `${major}.${minor}.${patch + 1}`;
}

export function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'release-notes';
}

export function defaultReleaseTitle(kind: ReleaseKind): string {
  if (kind === 'major') {
    return 'Major Release';
  }
  if (kind === 'minor') {
    return 'Feature Update';
  }
  return 'Patch Update';
}

export function defaultReleaseOneLiner(kind: ReleaseKind): string {
  if (kind === 'major') {
    return 'Worker-first WeChat bridge for local Claude Code, with a major release update that may include breaking changes.';
  }
  if (kind === 'minor') {
    return 'Worker-first WeChat bridge for local Claude Code, with new capabilities and compatibility-safe updates.';
  }
  return 'Worker-first WeChat bridge for local Claude Code, with stability fixes and usability improvements.';
}

export function todayIsoDate(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function parseChangelog(input: string): ParsedChangelog {
  const matches = [...input.matchAll(CHANGELOG_HEADING_REGEX)];
  if (matches.length === 0) {
    throw new Error('CHANGELOG.md 中没有找到任何二级版本标题');
  }

  const preamble = input.slice(0, matches[0].index ?? 0).trimEnd();
  let unreleasedBody = '';
  const releasedSections: ReleaseSection[] = [];

  matches.forEach((match, index) => {
    const headingStart = match.index ?? 0;
    const bodyStart = headingStart + match[0].length;
    const nextHeadingStart = index + 1 < matches.length ? matches[index + 1].index ?? input.length : input.length;
    const body = input.slice(bodyStart, nextHeadingStart).trim();
    const label = match[1];

    if (label === 'Unreleased') {
      unreleasedBody = body;
      return;
    }

    const heading = match[2] ? `## [${label}] - ${match[2]}` : `## [${label}]`;
    releasedSections.push({ heading, body });
  });

  return { preamble, unreleasedBody, releasedSections };
}

export function buildChangelog(input: string, nextVersion: string, releaseDate: string, releasedBody: string): string {
  const parsed = parseChangelog(input);
  const parts: string[] = [];

  parts.push(parsed.preamble);
  parts.push('## [Unreleased]');
  parts.push(`## [${nextVersion}] - ${releaseDate}`);
  parts.push(releasedBody.trim() || '_No user-facing notes recorded._');

  for (const section of parsed.releasedSections) {
    parts.push(section.heading);
    parts.push(section.body.trim());
  }

  return `${parts.filter(Boolean).join('\n\n').trim()}\n`;
}

export function extractUnreleasedBody(input: string): string {
  return parseChangelog(input).unreleasedBody.trim();
}

export function buildReleaseNotes(version: string, title: string, changelogBody: string): string {
  return `# v${version} · ${title}

\`v${version}\` contains the following user-facing changes.

## Included changes

${changelogBody.trim() || '_No user-facing notes recorded._'}

## Recommended first check

\`\`\`bash
node dist/cli.js status
\`\`\`

If this release affects long-running worker behavior, also verify:

\`\`\`bash
node dist/cli.js service status
\`\`\`
`;
}

export function buildGitHubReleaseNotes(version: string, title: string, oneLiner: string, changelogBody: string): string {
  return `# v${version} · ${title}

${oneLiner}

## Included changes

${changelogBody.trim() || '_No user-facing notes recorded._'}

## Recommended first check

\`\`\`bash
node dist/cli.js status
\`\`\`

If this release affects long-running worker behavior, also verify:

\`\`\`bash
node dist/cli.js service status
\`\`\`

## Links

- Repository: https://github.com/itzone-x/wechat-claude-assistant
- README: https://github.com/itzone-x/wechat-claude-assistant/blob/main/README.md
`;
}

export function replaceLatestReleaseDocLink(content: string, nextPath: string): string {
  return content.replace(/docs\/releases\/v\d+\.\d+\.\d+-[a-z0-9-]+\.md/g, nextPath);
}

export function updateRecommendedReleaseTitle(content: string, version: string, title: string): string {
  return content.replace(/`v\d+\.\d+\.\d+ · [^`]+`/g, `\`v${version} · ${title}\``);
}

export function updateRecommendedReleaseOneLiner(content: string, oneLiner: string): string {
  return content.replace(
    /## Recommended Release One-Liner\s*\n(?:\s*\n)*(.*?)(?=\n## |\s*$)/s,
    `## Recommended Release One-Liner\n\n${oneLiner}`
  );
}
