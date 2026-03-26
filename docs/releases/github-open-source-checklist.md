# GitHub Open-Source Checklist

这份清单用于第一次公开仓库前的最后检查。

## 1. 仓库内容

建议公开：

- `src/`
- `package.json`
- `package-lock.json`
- `README.md`
- `USAGE.md`
- `ARCHITECTURE.md`
- `CHANGELOG.md`
- `SUMMARY.md`
- `TEST.md`
- `docs/product/`
- `docs/advanced/`
- `docs/releases/`
- `.claude-plugin/plugin.json`
- `plugin.mcp.json`

建议不要公开：

- `docs/content/`
- `docs/plans/`
- `.claude/`
- `.mcp.json`
- `session-log.md`
- `channel.json`
- `dist/`
- `node_modules/`

## 2. GitHub 仓库简介

### Repository name

`wechat-claude-holdhands`

### Description

Use WeChat as a worker-first remote task entry for local Claude Code, with optional advanced Channels mode.

### Suggested topics

- `wechat`
- `claude-code`
- `ai-agent`
- `worker`
- `mcp`
- `multimodal`
- `automation`
- `typescript`
- `local-first`

## 3. 首个 Release 标题

`v0.1.0 · Worker-First Public Release`

## 4. 首个 Release 摘要

- worker-first 主路径已可用
- 支持微信文本、图片、图片链接、语音输入
- 支持后台常驻与 macOS 自动启动
- 已修复会话恢复、并发控制、重复回复等关键稳定性问题

## 5. 发布前自检

```bash
npm install
npm test
```

然后人工检查：

```bash
node dist/cli.js status
```

## 6. 上传前再确认一次

- 没有真实 token
- 没有个人 `.claude/` 配置
- 没有会话记录
- 没有公众号稿件和内部计划稿
