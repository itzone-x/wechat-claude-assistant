import fs from 'node:fs';
import path from 'node:path';
import { versionFromTag } from './github-release.js';

export interface ManualVerificationStatus {
  status: string;
  verifier: string;
  verifiedAt: string;
}

export function manualVerificationPathForTag(tag: string): string {
  return `docs/releases/manual-verification-v${versionFromTag(tag)}.md`;
}

export function buildManualVerificationTemplate(tag: string): string {
  return `# Manual Verification for ${tag}

Status: PENDING
Verifier:
Verified-at:
Notes:

## Required checks

- [ ] node dist/cli.js status
- [ ] 微信发送 /echo 你好
- [ ] 再发一条普通文本任务
- [ ] 如果本次改动涉及图片、语音、URL 或文件附件，再补一条对应多模态消息
`;
}

export function parseManualVerificationStatus(markdown: string): ManualVerificationStatus {
  const status = markdown.match(/^Status:\s*(.+)$/m)?.[1]?.trim() ?? '';
  const verifier = markdown.match(/^Verifier:\s*(.*)$/m)?.[1]?.trim() ?? '';
  const verifiedAt = markdown.match(/^Verified-at:\s*(.*)$/m)?.[1]?.trim() ?? '';

  return {
    status,
    verifier,
    verifiedAt,
  };
}

export function ensureManualVerificationTemplate(rootDir: string, tag: string): string {
  const relativePath = manualVerificationPathForTag(tag);
  const filePath = path.join(rootDir, relativePath);

  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buildManualVerificationTemplate(tag));
  }

  return relativePath;
}

export function assertManualVerificationApproved(rootDir: string, tag: string): string {
  const relativePath = manualVerificationPathForTag(tag);
  const filePath = path.join(rootDir, relativePath);

  if (!fs.existsSync(filePath)) {
    throw new Error(`缺少人工验收记录：${relativePath}。请先完成真实验收，并把 Status 改为 PASS 后再发布。`);
  }

  const markdown = fs.readFileSync(filePath, 'utf8');
  const verification = parseManualVerificationStatus(markdown);

  if (verification.status !== 'PASS') {
    throw new Error(`人工验收未通过：${relativePath}。当前 Status=${verification.status || 'EMPTY'}，发布已拦截。`);
  }

  if (!verification.verifier) {
    throw new Error(`人工验收记录缺少 Verifier：${relativePath}。请补充验收人后再发布。`);
  }

  if (!verification.verifiedAt) {
    throw new Error(`人工验收记录缺少 Verified-at：${relativePath}。请补充验收时间后再发布。`);
  }

  return relativePath;
}
