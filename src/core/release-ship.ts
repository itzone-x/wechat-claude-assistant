import { ReleaseKind, bumpVersion } from './release.js';

export interface ReleaseShipOptions {
  kind: ReleaseKind;
  title?: string;
  slug?: string;
  date?: string;
  allowEmpty: boolean;
  skipPublish: boolean;
  dryRun: boolean;
}

export function parseReleaseShipArgs(argv: string[]): ReleaseShipOptions {
  const [kindArg, ...rest] = argv;
  if (kindArg !== 'patch' && kindArg !== 'minor' && kindArg !== 'major') {
    throw new Error(
      '用法: node dist/release-ship-cli.js <patch|minor|major> [--title "Title"] [--slug "slug"] [--date YYYY-MM-DD] [--allow-empty] [--skip-publish] [--dry-run]',
    );
  }

  const options: ReleaseShipOptions = {
    kind: kindArg,
    allowEmpty: false,
    skipPublish: false,
    dryRun: false,
  };

  for (let i = 0; i < rest.length; i += 1) {
    const current = rest[i];
    const next = rest[i + 1];

    if (current === '--allow-empty') {
      options.allowEmpty = true;
      continue;
    }
    if (current === '--skip-publish') {
      options.skipPublish = true;
      continue;
    }
    if (current === '--dry-run') {
      options.dryRun = true;
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

export function buildReleasePrepareArgs(options: ReleaseShipOptions): string[] {
  const args: string[] = [options.kind];

  if (options.title) {
    args.push('--title', options.title);
  }
  if (options.slug) {
    args.push('--slug', options.slug);
  }
  if (options.date) {
    args.push('--date', options.date);
  }
  if (options.allowEmpty) {
    args.push('--allow-empty');
  }

  return args;
}

export function nextReleaseVersion(currentVersion: string, options: ReleaseShipOptions): string {
  return bumpVersion(currentVersion, options.kind);
}

export function releaseCommitMessage(version: string): string {
  return `Release v${version}`;
}

export function releaseTag(version: string): string {
  return `v${version}`;
}

export function buildShipPlanSummary(
  currentVersion: string,
  options: ReleaseShipOptions,
  hasPublishToken: boolean,
): string {
  const nextVersion = nextReleaseVersion(currentVersion, options);
  const tag = releaseTag(nextVersion);
  const publishMode = options.skipPublish ? 'skip' : hasPublishToken ? 'publish' : 'manual';

  return [
    `当前版本: v${currentVersion}`,
    `目标版本: ${tag}`,
    `发布类型: ${options.kind}`,
    `发布提交: ${releaseCommitMessage(nextVersion)}`,
    `GitHub Release: ${publishMode}`,
  ].join('\n');
}
