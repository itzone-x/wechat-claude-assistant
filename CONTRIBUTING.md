# Contributing

感谢你愿意参与这个项目。

这个仓库的主目标很明确：

- 让微信成为本地 Claude Code 的稳定任务入口
- 默认路径保持 `worker-first`
- `channels` 只作为高级模式保留

如果你准备提交改动，建议先读：

- [README.md](README.md)
- [USAGE.md](USAGE.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [RELEASING.md](RELEASING.md)

## 开发环境

- Node.js `18+`
- Claude Code `2.1.80+`
- macOS 是当前主要验证环境

安装依赖：

```bash
npm install
```

构建：

```bash
npm run build
```

测试：

```bash
npm test
```

## 提交建议

- 优先修主路径，也就是 `worker` 模式
- 如果改了用户体验或稳定性，顺手更新 `README.md`、`USAGE.md` 和 `CHANGELOG.md`
- 如果改动已经对用户可感知，按 `RELEASING.md` 判断是否应该发一个明确版本
- 如果改了消息轮询、会话恢复、并发控制或多模态解析，尽量补对应测试
- 不要把本地调试文件、个人配置或私有材料提交进仓库

特别注意不要提交这些内容：

- `.claude/`
- `.mcp.json`
- `docs/content/`
- `docs/plans/`
- `session-log.md`
- 任何真实 token、账号信息或本机日志

## Issue 建议

提 issue 时，尽量附上这些信息：

- 运行命令
- `node dist/cli.js status` 输出
- `tail -n 120 ~/.claude/wechat-agent/runtime/worker.log` 输出
- 是否在 `worker` 还是 `channels` 模式下复现

## Pull Request 建议

PR 描述建议回答这 4 个问题：

1. 改了什么
2. 为什么要改
3. 怎么验证
4. 有没有影响 `worker-first` 主路径
