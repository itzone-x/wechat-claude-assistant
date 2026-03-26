# v0.1.0 · Worker-First 初版可用发布

这次是项目第一次可以对外认真说“能用了”的版本。

它不再把 Channels 当成默认路径，而是正式改成：

- 主路径：`worker-first`
- 高级模式：`channels`

## 这版的重点

- 支持从微信直接给本地 Claude Code 派任务
- 支持微信文本、图片、图片链接和语音输入
- 支持后台 worker 运行
- 支持 macOS `launchd` 自动启动
- 支持任务阶段状态回传与静默默认回复节奏
- 支持同一微信会话下的并发拒绝
- 支持 Claude 会话恢复
- 支持入站消息去重，避免重复回复
- 支持 worker 与高级模式隔离，避免互相污染

## 这版修掉的关键问题

- 修复二维码页面被当成图片渲染的问题
- 修复 `Session ID is already in use`
- 修复后台 `launchd` 环境里找不到 `claude`
- 修复同会话第二条任务没有稳定被拒绝
- 修复 worker 误调用项目 MCP 工具导致的“请授权工具权限”提示
- 修复 `stop` 后 launchd 立即自动拉起，看起来像旧进程没停的问题
- 修复同一条语音、文字或多模态消息被重复投递后出现重复回复的问题

## 当前推荐用法

```bash
npm install
npm run build
node dist/cli.js install
node dist/cli.js start
```

后台常驻：

```bash
node dist/cli.js start --daemon
```

安装自动启动：

```bash
node dist/cli.js service install
```

## 当前状态

- 自动化测试：`67/67`
- 主路径已完成真实微信联调
- `channels` 仍保留，但只建议高级用户显式启用

## 文档

- 产品与架构说明：[`docs/product/wechat-claude-code-assistant-overview.md`](/Users/zhoutianyou/Documents/其他/AI相关/wechat and claude code holding hands/wechat-claude-channel/docs/product/wechat-claude-code-assistant-overview.md)
- 发布说明：[`docs/releases/v0.1.0-worker-first.md`](/Users/zhoutianyou/Documents/其他/AI相关/wechat and claude code holding hands/wechat-claude-channel/docs/releases/v0.1.0-worker-first.md)
- 高级模式说明：[`docs/advanced/channels-mode.md`](/Users/zhoutianyou/Documents/其他/AI相关/wechat and claude code holding hands/wechat-claude-channel/docs/advanced/channels-mode.md)
- 变更记录：[`CHANGELOG.md`](/Users/zhoutianyou/Documents/其他/AI相关/wechat and claude code holding hands/wechat-claude-channel/CHANGELOG.md)
