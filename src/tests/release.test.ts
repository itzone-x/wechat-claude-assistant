import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildChangelog,
  bumpVersion,
  defaultReleaseOneLiner,
  defaultReleaseTitle,
  extractUnreleasedBody,
  replaceLatestReleaseDocLink,
  slugifyTitle,
  updateRecommendedReleaseOneLiner,
  updateRecommendedReleaseTitle,
} from '../core/release.js';

test('bumpVersion increments semantic versions by kind', () => {
  assert.equal(bumpVersion('0.1.1', 'patch'), '0.1.2');
  assert.equal(bumpVersion('0.1.1', 'minor'), '0.2.0');
  assert.equal(bumpVersion('0.1.1', 'major'), '1.0.0');
});

test('extractUnreleasedBody reads the unreleased section', () => {
  const changelog = `# Changelog

## [Unreleased]

### Fixed
- Fixed duplicate replies

## [0.1.1] - 2026-03-27

### Added
- Added release workflow docs
`;

  assert.equal(extractUnreleasedBody(changelog), '### Fixed\n- Fixed duplicate replies');
});

test('buildChangelog promotes unreleased content into a new release section', () => {
  const changelog = `# Changelog

## [0.1.0] - 2026-03-26

### Added
- Initial release

## [Unreleased]

### Fixed
- Fixed duplicate replies

## [0.1.1] - 2026-03-27

### Fixed
- Fixed session recovery
`;

  const output = buildChangelog(changelog, '0.1.2', '2026-03-27', '### Fixed\n- Fixed duplicate replies');

  assert.match(output, /## \[Unreleased\]\n\n## \[0\.1\.2\] - 2026-03-27/);
  assert.match(output, /## \[0\.1\.1\] - 2026-03-27/);
  assert.doesNotMatch(output, /## \[Unreleased\]\n\n### Fixed\n- Fixed duplicate replies/);
});

test('release helpers update links and metadata snippets', () => {
  assert.equal(slugifyTitle('Stability and Onboarding Update'), 'stability-and-onboarding-update');
  assert.equal(defaultReleaseTitle('patch'), 'Patch Update');
  assert.match(defaultReleaseOneLiner('patch'), /stability fixes and usability improvements/);

  const readme = '- 发布说明：[`docs/releases/v0.1.1-stability-and-onboarding.md`](docs/releases/v0.1.1-stability-and-onboarding.md)\n';
  assert.equal(
    replaceLatestReleaseDocLink(readme, 'docs/releases/v0.1.2-patch-update.md'),
    '- 发布说明：[`docs/releases/v0.1.2-patch-update.md`](docs/releases/v0.1.2-patch-update.md)\n'
  );

  const metadata = `## Recommended Release Title

\`v0.1.1 · Stability and Onboarding Update\`

## Recommended Release One-Liner

Old line
`;

  const updatedTitle = updateRecommendedReleaseTitle(metadata, '0.1.2', 'Patch Update');
  const updated = updateRecommendedReleaseOneLiner(updatedTitle, 'New one liner');
  assert.match(updated, /`v0\.1\.2 · Patch Update`/);
  assert.match(updated, /## Recommended Release One-Liner\n\nNew one liner/);
});
