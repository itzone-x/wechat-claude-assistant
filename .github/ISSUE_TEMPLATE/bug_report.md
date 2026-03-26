---
name: Bug report
about: 报告一个可复现的问题
title: "[Bug] "
labels: bug
assignees: ''
---

## 问题描述

请清楚描述你遇到的问题。

## 复现步骤

1. 
2. 
3. 

## 预期行为

## 实际行为

## 环境信息

- Node.js 版本：
- Claude Code 版本：
- 操作系统：
- 运行模式：`worker` / `channels`

## 诊断信息

请尽量附上：

```bash
node dist/cli.js status
tail -n 120 ~/.claude/wechat-agent/runtime/worker.log
```

请先手动检查并移除其中的 token、账号或其他敏感信息。
