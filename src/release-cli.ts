import fs from 'node:fs';
import path from 'node:path';
import {
  buildChangelog,
  buildGitHubReleaseNotes,
  buildReleaseNotes,
  bumpVersion,
  defaultReleaseOneLiner,
  defaultReleaseTitle,
  extractUnreleasedBody,
  ReleaseKind,
  replaceLatestReleaseDocLink,
  slugifyTitle,
  todayIsoDate,
  updateRecommendedReleaseOneLiner,
  updateRecommendedReleaseTitle,
} from './core/release.js';

interface CliOptions {
  kind: ReleaseKind;
  title?: string;
  slug?: string;
  date?: string;
  allowEmpty: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const [kindArg, ...rest] = argv;
  if (kindArg !== 'patch' && kindArg !== 'minor' && kindArg !== 'major') {
    throw new Error('用法: node dist/release-cli.js <patch|minor|major> [--title "Title"] [--slug "slug"] [--date YYYY-MM-DD] [--allow-empty]');
  }

  const options: CliOptions = { kind: kindArg, allowEmpty: false };

  for (let i = 0; i < rest.length; i += 1) {
    const current = rest[i];
    const next = rest[i + 1];

    if (current === '--allow-empty') {
      options.allowEmpty = true;
      i -= 0;
      continue;
    }
    if (current === '--title' && next) {
      options.title = next;
      i += 1;
      continue;
    }
    if (current === '--slug' && next) {
      options.slug = next;
      i += 1;
      continue;
    }
    if (current === '--date' && next) {
      options.date = next;
      i += 1;
      continue;
    }
    throw new Error(`不支持的参数: ${current}`);
  }

  return options;
}

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}

function writeJson(filePath: string, data: Record<string, unknown>): void {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const rootDir = process.cwd();
  const packageJsonPath = path.join(rootDir, 'package.json');
  const packageLockPath = path.join(rootDir, 'package-lock.json');
  const changelogPath = path.join(rootDir, 'CHANGELOG.md');
  const readmePath = path.join(rootDir, 'README.md');
  const usagePath = path.join(rootDir, 'USAGE.md');
  const repositoryMetadataPath = path.join(rootDir, 'docs/releases/github-repository-metadata.md');
  const checklistPath = path.join(rootDir, 'docs/releases/github-open-source-checklist.md');

  const packageJson = readJson(packageJsonPath);
  const packageLock = readJson(packageLockPath);
  const currentVersion = String(packageJson.version ?? '');
  if (!currentVersion) {
    throw new Error('package.json 中没有 version');
  }

  const nextVersion = bumpVersion(currentVersion, options.kind);
  const releaseDate = options.date ?? todayIsoDate();
  const changelog = fs.readFileSync(changelogPath, 'utf8');
  const unreleasedBody = extractUnreleasedBody(changelog);

  if (!unreleasedBody && !options.allowEmpty) {
    throw new Error('CHANGELOG.md 的 [Unreleased] 为空。请先补变更说明，或者显式传 --allow-empty。');
  }

  const releaseTitle = options.title ?? defaultReleaseTitle(options.kind);
  const releaseSlug = options.slug ?? slugifyTitle(releaseTitle);
  const oneLiner = defaultReleaseOneLiner(options.kind);
  const releaseNotesRelativePath = `docs/releases/v${nextVersion}-${releaseSlug}.md`;
  const githubReleaseRelativePath = `docs/releases/github-release-v${nextVersion}.md`;

  packageJson.version = nextVersion;
  packageLock.version = nextVersion;
  if (packageLock.packages && typeof packageLock.packages === 'object') {
    const packages = packageLock.packages as Record<string, { version?: string }>;
    if (packages['']) {
      packages[''].version = nextVersion;
    }
  }

  writeJson(packageJsonPath, packageJson);
  writeJson(packageLockPath, packageLock);
  fs.writeFileSync(changelogPath, buildChangelog(changelog, nextVersion, releaseDate, unreleasedBody));

  fs.writeFileSync(
    path.join(rootDir, releaseNotesRelativePath),
    buildReleaseNotes(nextVersion, releaseTitle, unreleasedBody)
  );
  fs.writeFileSync(
    path.join(rootDir, githubReleaseRelativePath),
    buildGitHubReleaseNotes(nextVersion, releaseTitle, oneLiner, unreleasedBody)
  );

  const readme = fs.readFileSync(readmePath, 'utf8');
  const usage = fs.readFileSync(usagePath, 'utf8');
  const repositoryMetadata = fs.readFileSync(repositoryMetadataPath, 'utf8');
  const checklist = fs.readFileSync(checklistPath, 'utf8');

  fs.writeFileSync(readmePath, replaceLatestReleaseDocLink(readme, releaseNotesRelativePath));
  fs.writeFileSync(usagePath, replaceLatestReleaseDocLink(usage, releaseNotesRelativePath));
  fs.writeFileSync(
    repositoryMetadataPath,
    updateRecommendedReleaseOneLiner(
      updateRecommendedReleaseTitle(repositoryMetadata, nextVersion, releaseTitle),
      oneLiner
    )
  );
  fs.writeFileSync(checklistPath, updateRecommendedReleaseTitle(checklist, nextVersion, releaseTitle));

  process.stdout.write(
    [
      `已准备发布版本: v${nextVersion}`,
      `发布标题: ${releaseTitle}`,
      `发布说明: ${releaseNotesRelativePath}`,
      `GitHub Release 文案: ${githubReleaseRelativePath}`,
      '下一步建议执行:',
      '1. npm test',
      `2. git commit -m "Release v${nextVersion}"`,
      `3. git tag v${nextVersion}`,
      '4. git push origin main',
      `5. git push origin v${nextVersion}`,
    ].join('\n')
  );
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
