import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildReleasePrepareArgs,
  buildShipPlanSummary,
  nextReleaseVersion,
  parseReleaseShipArgs,
  releaseCommitMessage,
  releaseTag,
} from '../core/release-ship.js';

test('parseReleaseShipArgs supports release:ship flags', () => {
  const options = parseReleaseShipArgs([
    'patch',
    '--title',
    'Stability Update',
    '--slug',
    'stability-update',
    '--date',
    '2026-03-27',
    '--allow-empty',
    '--skip-publish',
    '--dry-run',
  ]);

  assert.deepEqual(options, {
    kind: 'patch',
    title: 'Stability Update',
    slug: 'stability-update',
    date: '2026-03-27',
    allowEmpty: true,
    skipPublish: true,
    dryRun: true,
  });
});

test('release ship helpers derive next version, commit and tag', () => {
  const options = parseReleaseShipArgs(['minor']);
  assert.equal(nextReleaseVersion('0.1.1', options), '0.2.0');
  assert.equal(releaseCommitMessage('0.2.0'), 'Release v0.2.0');
  assert.equal(releaseTag('0.2.0'), 'v0.2.0');
  assert.deepEqual(buildReleasePrepareArgs(options), ['minor']);
});

test('buildShipPlanSummary reflects publish mode', () => {
  const manual = buildShipPlanSummary('0.1.1', parseReleaseShipArgs(['patch']), false);
  const publish = buildShipPlanSummary('0.1.1', parseReleaseShipArgs(['patch']), true);
  const skip = buildShipPlanSummary('0.1.1', parseReleaseShipArgs(['patch', '--skip-publish']), true);

  assert.match(manual, /人工验收记录: docs\/releases\/manual-verification-v0\.1\.2\.md/);
  assert.match(manual, /GitHub Release: manual/);
  assert.match(publish, /GitHub Release: publish/);
  assert.match(skip, /GitHub Release: skip/);
});
