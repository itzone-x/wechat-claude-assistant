# 架构设计文档

## 当前架构方向

这个项目不再把“Channel 插件”当成唯一产品形态，而是拆成三层：

```text
WeChat / ClawBot
        |
        v
WeChat Bridge Core
  - QR 登录
  - iLink API 访问
  - 长轮询 getupdates
  - 状态落盘
  - 授权用户绑定
        |
        +------------------------+
        |                        |
        v                        v
worker 模式                   channels 模式
  - 本地任务执行器              - Claude Code Channel 适配器
  - conversation -> session    - MCP stdio server
  - 结果回发微信                - 通知当前 Claude 会话
```

## 模块划分

### `src/core/`

负责与业务无关的底层能力：

- `config.ts`：状态目录与默认配置
- `state.ts`：本地 JSON / 文本读写
- `ilink-api.ts`：二维码登录相关 API
- `login-qr.ts`：登录流程与账号持久化
- `pairing.ts`：授权微信用户绑定

### `src/commands/`

负责 CLI 命令入口：

- `install.ts`
- `login.ts`
- `start.ts`
- `status.ts`
- `doctor.ts`

### `src/ui/`

负责安装向导和命令行交互：

- `prompts.ts`
- `wizard.ts`

### `src/runtime/`

负责默认 `worker` 模式：

- `worker.ts`：轮询微信消息，调用本地 Claude Code，回发结果

### `src/adapters/channels/`

负责高级 `channels` 模式：

- `server.ts`：启动 channels server
- `bridge.ts`：把微信消息转换成 channel notification
- 不再承担主产品入口职责

## 第一阶段已落地的设计原则

### 1. 入口统一

新的统一入口是：

- `node dist/cli.js install`
- `node dist/cli.js start`

而不是让用户先理解 MCP 配置和 Channel 术语。

### 2. 状态落盘

当前持久化信息包括：

- 微信账号信息
- 安装配置
- 已授权微信用户
- 会话 `conversation -> sessionId` 映射

### 3. 模式分层

`worker` 是默认模式，`channels` 是高级模式。  
这样可以同时覆盖：

- “通勤路上微信派活”
- “坐在终端前把微信消息推入当前会话”

### 4. 配对优先

默认只接受已绑定微信用户的控制消息，避免把外部聊天入口直接暴露给本地高权限 agent。

## 当前结论

- `worker` 是默认产品路径
- `channels` 是高级模式
- legacy 实验入口不再保留在推荐使用路径中
