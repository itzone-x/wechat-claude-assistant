# 项目总结

## 当前定位

这个项目现在已经明确切成 `worker-first` 产品：

- 默认路径：微信派活，本地 worker 执行 Claude Code，再把结果回微信
- 高级模式：`channels`
- legacy 实验入口：已归档，不再作为推荐路径

## 当前已完成

### 产品入口

- CLI 主命令已经统一到：
  - `install`
  - `login`
  - `start`
  - `service`
  - `status`
  - `doctor`
- 安装向导默认推荐 worker 模式
- `channels` 已经被明确标成高级模式

### WeChat Bridge Core

- 微信扫码登录与账号持久化
- 授权微信用户绑定
- worker 和 channels 分别使用独立的 `sync_buf` 状态
- iLink 轮询与回复已经抽成独立 bridge

### Worker Runtime

- worker 后台运行
- 任务状态回传
- `conversation -> sessionId` 持久化
- `TaskManager` 已经从直接 `spawn('claude')` 演进成 runner 架构
- `ClaudeCodeRunner` 支持可注入命令与参数，便于测试和后续替换执行后端

### 高级模式

- `channels` 适配层保留
- `.claude-plugin/plugin.json` / `plugin.mcp.json` 作为仓库内高级模式包装入口保留
- 本地 `.mcp.json` 继续作为运行时生成配置，不作为公开仓库内容提交

### 自动化验证

当前自动化测试已经覆盖：

- worker 默认模式文案与向导
- channels 配置合并与帮助文案
- 登录二维码 HTML 渲染
- worker / channels 独立 sync 游标
- channel bridge 状态机
- task manager 成功 / 失败 / 并发保护
- fake Claude runner 成功 / 失败路径
- doctor / launchd 基础检查

当前全量结果：

- `npm test`
- `67 / 67` 通过

## 仍需人工联调

自动化测试已经比较完整，但下面这些还需要在真实机器上做外部联调：

- 微信扫码登录后的真实收发
- worker 模式下真实微信派活
- worker 模式下真实 `claude` 子进程执行
- launchd 真实安装与开机自启
- channels 模式在满足官方条件时的真实联调

## 推荐阅读顺序

1. `README.md`
2. `USAGE.md`
3. `ARCHITECTURE.md`
4. `docs/product/wechat-claude-code-assistant-overview.md`
