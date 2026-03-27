import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  buildReleasePrepareArgs,
  buildShipPlanSummary,
  parseReleaseShipArgs,
  releaseCommitMessage,
  releaseTag,
} from './core/release-ship.js';

function run(command: string, args: string[], cwd: string, env = process.env): void {
  execFileSync(command, args, {
    cwd,
    env,
    stdio: 'inherit',
  });
}

function readPackageVersion(rootDir: string): string {
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')) as { version?: string };
  if (!packageJson.version) {
    throw new Error('package.json 中没有 version');
  }
  return packageJson.version;
}

function ensureCleanWorktree(rootDir: string): void {
  const output = execFileSync('git', ['status', '--porcelain'], {
    cwd: rootDir,
    encoding: 'utf8',
  }).trim();

  if (output) {
    throw new Error('工作区不干净。请先提交或清理现有改动，再运行 release:ship。');
  }
}

function main(): void {
  const options = parseReleaseShipArgs(process.argv.slice(2));
  const rootDir = process.cwd();
  const currentVersion = readPackageVersion(rootDir);
  const hasPublishToken = Boolean(process.env.GITHUB_PERSONAL_ACCESS_TOKEN);

  if (options.dryRun) {
    process.stdout.write(`${buildShipPlanSummary(currentVersion, options, hasPublishToken)}\n`);
    return;
  }

  ensureCleanWorktree(rootDir);

  run(process.execPath, ['dist/release-cli.js', ...buildReleasePrepareArgs(options)], rootDir);

  const nextVersion = readPackageVersion(rootDir);
  const tag = releaseTag(nextVersion);

  run('npm', ['test'], rootDir);
  run('git', ['add', '.'], rootDir);
  run('git', ['commit', '-m', releaseCommitMessage(nextVersion)], rootDir);
  run('git', ['tag', tag], rootDir);
  run('git', ['push', 'origin', 'main'], rootDir);
  run('git', ['push', 'origin', tag], rootDir);

  if (options.skipPublish) {
    process.stdout.write(`已完成版本提交与 tag 推送，跳过 GitHub Release 发布: ${tag}\n`);
    return;
  }

  if (!hasPublishToken) {
    process.stdout.write(`已完成版本提交与 tag 推送。缺少 GITHUB_PERSONAL_ACCESS_TOKEN，请手动运行 npm run release:publish -- --tag ${tag}\n`);
    return;
  }

  run(process.execPath, ['dist/release-publish-cli.js', '--tag', tag], rootDir, process.env);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
