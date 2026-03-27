# v0.1.1 · Stability and Onboarding Update

`v0.1.1` focuses on making the worker-first path stable enough for real daily use.

## Highlights

- Multimodal worker input support now covers text, images, image links, and voice.
- Duplicate-reply handling is more robust against repeated upstream message delivery.
- Worker session recovery is more reliable across projects and stale Claude session states.
- The install flow is smoother for new users, especially when auto-start is enabled.

## What changed

### Multimodal input

- Added native image upload handling for worker mode.
- Added image link download and local staging support.
- Added voice transcript ingestion and audio attachment staging.
- Improved mixed-input understanding for `image + text` and `voice + text`.

### Stability fixes

- Fixed duplicate worker replies caused by repeated upstream message delivery.
- Fixed stale session recovery so the worker can rebuild a missing Claude session and continue.
- Fixed cross-project session leakage by scoping conversation sessions to both workspace root and WeChat user.
- Fixed `launchd` runtime status detection so service-managed workers show up correctly in `status`.

### Install and onboarding

- Improved the install flow for users who enable auto-start during setup.
- The installer now attempts to install and launch the local service immediately.
- After successful auto-start setup, the installer prints a concise worker status summary so users can see whether the system is really ready.

## Recommended first check

After setup, verify:

```bash
node dist/cli.js service status
node dist/cli.js status
```

Then send:

```text
/echo 你好
```

If you get a reply in WeChat, the main worker path is ready.

## Links

- Repository: https://github.com/itzone-x/wechat-claude-assistant
- README: https://github.com/itzone-x/wechat-claude-assistant/blob/main/README.md
- Release notes: [`docs/releases/v0.1.1-stability-and-onboarding.md`](v0.1.1-stability-and-onboarding.md)
