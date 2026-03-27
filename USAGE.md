# 使用指南

## 推荐路径

当前版本推荐先使用 `worker` 模式，也就是：

- 在微信里发任务
- 本地 Claude Code 非交互执行
- 结果回发到微信

高级用户如果已经在 Claude Code 终端里工作，再考虑 `channels` 模式。

如果你要先理解项目定位、架构和使用边界，建议先读：

- [`docs/product/wechat-claude-code-assistant-overview.md`](docs/product/wechat-claude-code-assistant-overview.md)
- [`docs/releases/v0.1.1-stability-and-onboarding.md`](docs/releases/v0.1.1-stability-and-onboarding.md)

## 前置要求

- Claude Code `2.1.80+`
- Node.js `18+`
- 微信可正常扫码登录 ClawBot

## 第一次安装

```bash
cd wechat-claude-assistant
npm install
npm run build
node dist/cli.js install
```

安装向导会帮你完成：

1. 环境检查
2. 默认模式选择
3. 微信扫码登录
4. 工作目录、执行策略与自动启动偏好保存
5. 默认模式与微信控制用户确认

扫码登录时，程序会优先尝试自动打开本地二维码页面；如果失败，会提示你手动打开对应文件。

## 常用命令

```bash
node dist/cli.js install
node dist/cli.js login
node dist/cli.js service status
node dist/cli.js service install
node dist/cli.js service uninstall
node dist/cli.js start
node dist/cli.js start --daemon
node dist/cli.js start --mode channels
node dist/cli.js stop
node dist/cli.js status
node dist/cli.js doctor
node dist/cli.js doctor --channels
node dist/cli.js doctor --fix
```

## 两种模式

### worker 模式

```bash
node dist/cli.js start
```

适合：

- 你不在终端前
- 你想从微信给本地 Claude Code 派任务
- 你希望结果回到微信

当前阶段实现会：

- 读取微信消息
- 用本地 `claude -p` 处理任务
- 在检测到图片、图片链接或语音时，先把媒体落到本地，再把媒体路径和文字任务一起交给 Claude
- 语音优先使用微信自动转写文本；如果语音媒体可下载，会把音频文件一并透传给 worker
- 默认静默，只在任务执行超过 5 秒时回一条简短进度提示
- 对微信入站消息做短窗口去重，并在 worker 重启后保留短时去重状态，尽量避免重复回复
- 把最终结果回发到微信

这条链路就是默认推荐路径，不要求 Claude Channels 可用。

后台常驻运行：

```bash
node dist/cli.js start --daemon
```

安装为 macOS 登录自动启动服务：

```bash
node dist/cli.js service install
```

查看自动启动服务状态：

```bash
node dist/cli.js service status
```

停止后台运行：

```bash
node dist/cli.js stop
```

### channels 模式

```bash
node dist/cli.js start --mode channels
```

适合：

- 你已经在 Claude Code 终端里工作
- 你想把微信消息直接桥接进当前会话
- 你需要真正的 `claude/channel` 通知而不是手动拉取工具

它是高级模式，不是当前产品的主路径。

如果安装时选择了 `channels` 模式，向导会在当前目录写入 `.mcp.json`。
仓库也提供了 `.claude-plugin/plugin.json` 和 `plugin.mcp.json` 作为高级模式包装入口。
当 Claude Code 请求工具权限时，微信里的 `yes <id>` / `no <id>` 会被桥接成 permission 响应。

更完整的高级模式说明见：

- [`docs/advanced/channels-mode.md`](docs/advanced/channels-mode.md)

## 状态目录

默认状态目录：

- `~/.claude/wechat-agent`

开发或测试时可以覆盖：

```bash
WECHAT_AGENT_STATE_DIR=/tmp/wechat-agent-state node dist/cli.js doctor
```

## 故障排查

### 微信里可以发哪些命令

- `/help`
- `/status`
- `/reset`
- `/echo 你好`

### 现在也支持哪些多模态输入

- 只发图片
- 图片 + 文字说明
- 文字里附图片链接
- 只发语音
- 语音 + 文字说明

如果图片来自微信原生上传，bridge 会优先按 iLink 消息里的图片字段下载到本地。
如果语音来自微信原生上传，bridge 会优先读取微信自动转写文本；同时会尝试下载语音媒体，并在可用时作为音频附件透传给 worker。
如果你部署环境的媒体下载域名和登录 `baseUrl` 不一致，可以额外设置：

```bash
WECHAT_AGENT_CDN_BASE_URL=https://your-media-host node dist/cli.js start
```

### 微信还没连上

运行：

```bash
node dist/cli.js login
```

### 想看当前模式和绑定信息

运行：

```bash
node dist/cli.js status
```

### 如果怀疑同一条消息被重复回复

先看当前 worker 状态：

```bash
node dist/cli.js status
```

再看日志里是否出现：

```text
[worker] 忽略重复消息: key=...; semantic=...
```

命令：

```bash
tail -n 120 ~/.claude/wechat-agent/runtime/worker.log
```

### 想先做环境检查

运行：

```bash
node dist/cli.js doctor
```

如果想顺手把 `.mcp.json` 和 `.claude/settings.local.json` 同步到当前推荐值，运行：

```bash
node dist/cli.js doctor --fix
```

## 旧入口说明

下面这些旧实验入口已经归档，不再建议使用：

- `interactive`
- `standalone`
- `test-channel`
- `test-reply`
