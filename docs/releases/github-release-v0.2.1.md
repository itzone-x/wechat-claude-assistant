# v0.2.1 · Stability and URL Parsing Update

Worker-first WeChat bridge for local Claude Code, with stability fixes and usability improvements.

## Included changes

### Added
- Added a dedicated web fetch subsystem for webpage ingestion so HTTP retrieval, proxy handling, transport fallback, and HTML extraction are no longer mixed in one file.
- Added DNS-aware SSRF protection for remote URL fetching, blocking hostnames that resolve to local or private network addresses.

### Changed
- Changed webpage fetching to use a proxy-aware transport order that prefers the current machine environment and falls back to a bypassed proxy strategy only when needed.
- Changed known placeholder chapter pages such as 3Q mobile novel fragments to degrade deterministically instead of attempting expensive browser fallback.

### Fixed
- Fixed public webpage retrieval reliability for common documentation and article sites by stabilizing the `fetch -> curl` fallback path.
- Fixed webpage summarization so missing-body pages no longer infer正文内容 from titles, navigation, or chapter metadata.

## Recommended first check

```bash
node dist/cli.js status
```

If this release affects long-running worker behavior, also verify:

```bash
node dist/cli.js service status
```

## Links

- Repository: https://github.com/itzone-x/wechat-claude-assistant
- README: https://github.com/itzone-x/wechat-claude-assistant/blob/main/README.md
