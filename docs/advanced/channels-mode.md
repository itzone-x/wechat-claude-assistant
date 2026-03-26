# Channels 高级模式说明

`channels` 不是本项目的主产品路径，而是面向高级用户和协议研究场景的扩展模式。

## 什么时候才需要它

只有在下面三件事都成立时，才建议使用：

- 你已经在 Claude Code 终端里工作
- 你明确想把微信消息直接桥接到“当前会话”
- 你的 Claude Code 环境本身支持 Channels

如果你的目标只是“在微信里给本地 Claude Code 派任务”，不要走这条路，直接使用 `worker` 模式。

## 它和 worker 模式的区别

### worker 模式

- 微信消息进入本地后台 worker
- worker 启动 Claude Code 子进程执行任务
- worker 把最终结果回发到微信
- 不依赖当前是否打开 Claude Code 会话

### channels 模式

- 微信消息被转成 `claude/channel` 通知
- 进入当前 Claude Code 会话
- 需要当前会话存活
- 更适合实时交互，而不是稳定后台派活

## 当前保留它的原因

- 它对协议研究和高级调试仍然有价值
- 它可以作为未来支持更强实时交互能力的扩展层
- 它保留了与 Claude Code Channels 规范对接的能力

## 使用方式

```bash
node dist/cli.js channels setup
node dist/cli.js start --mode channels
```

如需检查高级模式配置：

```bash
node dist/cli.js doctor --channels
node dist/cli.js doctor --fix
```

## 风险与限制

- 依赖 Claude Code Channels 能力
- 依赖当前会话在线
- 比 worker 模式更容易受到本地 Claude 配置、权限、MCP 工具白名单影响
- 不建议作为普通用户默认路径
