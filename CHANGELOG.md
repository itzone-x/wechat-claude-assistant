# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2026-03-26

### Added
- Added a worker-first WeChat task runtime that polls WeChat messages, runs Claude Code locally, and sends the final text result back to WeChat.
- Added a dedicated WeChat bridge core with per-mode sync cursor isolation for `worker` and `channels`.
- Added a `ClaudeCodeRunner` abstraction so worker execution can be tested without a real Claude binary.
- Added persistent conversation-to-session mapping and runtime status storage.
- Added worker-side slash commands: `/help`, `/echo`, `/status`, `/reset`.
- Added daemon and macOS `launchd` service support for long-running local operation.
- Added QR login improvements for text QR, SVG, image QR, and remote QR page URLs.
- Added product docs, release notes, and a product/architecture overview for onboarding new users.

### Changed
- Changed the product default from a Channels-oriented prototype to a worker-first local agent.
- Changed CLI help, install wizard, README, usage docs, and doctor guidance to make worker mode the primary path.
- Changed worker session continuation to use `claude --resume <sessionId>` for existing conversations and `--session-id` only for new sessions.
- Changed `doctor` to prioritize worker checks by default, while keeping Channels checks as an explicit advanced path.
- Changed `stop` so it correctly handles `launchd`-managed workers instead of letting them auto-restart unexpectedly.

### Fixed
- Fixed WeChat QR rendering when the API returns a remote QR page URL instead of a direct image.
- Fixed background worker execution under `launchd` by resolving the absolute `claude` binary path and exporting it to the service environment.
- Fixed same-conversation concurrency handling so a second task is rejected while the first task is active.
- Fixed worker pollution from project MCP tools by forcing an empty MCP config for worker subprocesses.
- Fixed the worker session reuse bug that caused `Error: Session ID ... is already in use`.

### Removed
- Removed legacy wrapper entrypoints that were no longer part of the supported main path.
- Removed legacy sync cursor handling from the active bridge path.
- Removed the old `dist/index.js` compatibility entrypoint from the supported runtime path.

## [Unreleased]

## [0.1.1] - 2026-03-27

### Added
- Added multimodal worker input support for native image uploads, image-only tasks, and image URLs embedded in text.
- Added local image staging so Claude Code can read downloaded image files together with the user task.
- Added voice input support for WeChat voice messages, including WeChat transcript ingestion and audio attachment staging.
- Added optional SILK-to-WAV transcoding support when `silk-wasm` is available, with raw `audio/silk` fallback otherwise.

### Changed
- Changed the worker prompt and request pipeline so image attachments and user text are interpreted together.
- Changed the worker prompt and request pipeline so voice transcripts, audio attachments, and user text are interpreted together.
- Changed channel notifications to include image path hints for advanced-mode debugging and fallback usage.
- Changed worker reply behavior to stay quiet by default and send a short `/status` hint only when a task runs longer than 5 seconds.
- Changed inbound message handling to keep a short-lived dedup snapshot across worker restarts, reducing repeated replies caused by duplicate WeChat deliveries.
- Changed conversation session storage to scope Claude session mappings by workspace root as well as WeChat user, avoiding cross-project session leakage on the same machine.
- Changed the install flow so choosing the auto-start preference now attempts to install and start the local launchd worker service immediately, then prints verification steps.
- Changed the install flow to print a concise worker status summary immediately after successful auto-start setup, reducing post-install guesswork for new users.

### Fixed
- Fixed duplicate worker replies when the same text, voice, or multimodal WeChat message is delivered more than once by the upstream polling API.
- Fixed a daemon/runtime race where an older worker could clear status or PID files after a newer worker had already started.
- Fixed stale session recovery so the worker automatically drops a missing Claude session and retries with a fresh one instead of failing the user task.
- Fixed the worker subprocess stdin handling so `claude -p` no longer emits the 3-second “no stdin data received” warning on normal task execution.
- Fixed launchd worker status detection so `node dist/cli.js status` correctly reports a running service-managed worker when a live PID file is present.
