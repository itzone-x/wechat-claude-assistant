import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertManualVerificationApproved,
  buildManualVerificationTemplate,
  ensureManualVerificationTemplate,
  manualVerificationPathForTag,
  parseManualVerificationStatus,
} from '../core/release-gate.js';

test('manual verification helpers derive versioned file paths and templates', () => {
  assert.equal(manualVerificationPathForTag('v0.2.0'), 'docs/releases/manual-verification-v0.2.0.md');
  assert.match(buildManualVerificationTemplate('v0.2.0'), /# Manual Verification for v0\.2\.0/);
  assert.match(buildManualVerificationTemplate('v0.2.0'), /Status: PENDING/);
});

test('parseManualVerificationStatus reads status fields from markdown', () => {
  const parsed = parseManualVerificationStatus(`# Manual Verification for v0.2.0

Status: PASS
Verifier: zhoutianyou
Verified-at: 2026-03-27 22:30
Notes: ok
`);

  assert.deepEqual(parsed, {
    status: 'PASS',
    verifier: 'zhoutianyou',
    verifiedAt: '2026-03-27 22:30',
  });
});

test('ensureManualVerificationTemplate creates a pending verification file', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-release-gate-'));
  fs.mkdirSync(path.join(rootDir, 'docs/releases'), { recursive: true });

  const relativePath = ensureManualVerificationTemplate(rootDir, 'v0.2.0');
  const filePath = path.join(rootDir, relativePath);

  assert.equal(relativePath, 'docs/releases/manual-verification-v0.2.0.md');
  assert.equal(fs.existsSync(filePath), true);
  assert.match(fs.readFileSync(filePath, 'utf8'), /Status: PENDING/);
});

test('assertManualVerificationApproved requires PASS verifier and timestamp', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-release-gate-'));
  const relativePath = 'docs/releases/manual-verification-v0.2.0.md';
  const filePath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  fs.writeFileSync(
    filePath,
    `# Manual Verification for v0.2.0

Status: PASS
Verifier: zhoutianyou
Verified-at: 2026-03-27 22:35
Notes:
`
  );

  assert.equal(assertManualVerificationApproved(rootDir, 'v0.2.0'), relativePath);
});

test('assertManualVerificationApproved rejects pending verification files', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-release-gate-'));
  const relativePath = ensureManualVerificationTemplate(rootDir, 'v0.2.0');

  assert.throws(
    () => assertManualVerificationApproved(rootDir, 'v0.2.0'),
    new RegExp(`人工验收未通过：${relativePath.replace('.', '\\.')}`)
  );
});
