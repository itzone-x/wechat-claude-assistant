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
import { assertManualVerificationApproved, manualVerificationPathForTag } from './core/release-gate.js';

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

function readWorktreeStatus(rootDir: string): string {
  return execFileSync('git', ['status', '--porcelain'], {
    cwd: rootDir,
    encoding: 'utf8',
  }).trim();
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

  const worktreeStatus = readWorktreeStatus(rootDir);
  let nextVersion = currentVersion;
  let tag = releaseTag(nextVersion);

  if (!worktreeStatus) {
    run(process.execPath, ['dist/release-cli.js', ...buildReleasePrepareArgs(options)], rootDir);
    nextVersion = readPackageVersion(rootDir);
    tag = releaseTag(nextVersion);

    try {
      assertManualVerificationApproved(rootDir, tag);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${message}\n已完成版本准备。请先完成人工验收并更新 ${manualVerificationPathForTag(tag)}，然后重新运行同一条 release:ship 命令。`
      );
    }
  } else {
    tag = releaseTag(currentVersion);
    const verificationPath = manualVerificationPathForTag(tag);
    try {
      assertManualVerificationApproved(rootDir, tag);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `工作区不干净，且未检测到可继续发布的人工验收通过状态。\n${message}\n如果这不是一个已准备好的发布工作区，请先清理改动后再运行 release:ship。`
      );
    }
    process.stdout.write(`检测到已准备好的发布工作区，将继续发布 ${tag}。\n使用的人工验收记录: ${verificationPath}\n`);
  }

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
