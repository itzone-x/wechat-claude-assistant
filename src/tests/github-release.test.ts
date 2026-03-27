import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGitHubReleasePayload,
  parseGitHubRepo,
  parseReleaseMarkdown,
  releaseMarkdownPathForTag,
  versionFromTag,
} from '../core/github-release.js';

test('parseGitHubRepo supports https and ssh remotes', () => {
  assert.deepEqual(parseGitHubRepo('https://github.com/itzone-x/wechat-claude-assistant.git'), {
    owner: 'itzone-x',
    repo: 'wechat-claude-assistant',
  });
  assert.deepEqual(parseGitHubRepo('git@github.com:itzone-x/wechat-claude-assistant.git'), {
    owner: 'itzone-x',
    repo: 'wechat-claude-assistant',
  });
});

test('parseReleaseMarkdown extracts release title and body', () => {
  const parsed = parseReleaseMarkdown(`# v0.1.1 · Stability and Onboarding Update

Body line 1

Body line 2
`);

  assert.equal(parsed.name, 'v0.1.1 · Stability and Onboarding Update');
  assert.equal(parsed.body, 'Body line 1\n\nBody line 2');
});

test('buildGitHubReleasePayload maps markdown into GitHub release payload', () => {
  const payload = buildGitHubReleasePayload(
    'v0.1.1',
    'main',
    `# v0.1.1 · Stability and Onboarding Update

Body
`,
  );

  assert.equal(payload.tag_name, 'v0.1.1');
  assert.equal(payload.target_commitish, 'main');
  assert.equal(payload.name, 'v0.1.1 · Stability and Onboarding Update');
  assert.equal(payload.body, 'Body');
  assert.equal(payload.draft, false);
  assert.equal(payload.prerelease, false);
});

test('release markdown path helpers derive versioned paths from tags', () => {
  assert.equal(versionFromTag('v0.1.1'), '0.1.1');
  assert.equal(versionFromTag('0.1.1'), '0.1.1');
  assert.equal(releaseMarkdownPathForTag('v0.1.1'), 'docs/releases/github-release-v0.1.1.md');
});
