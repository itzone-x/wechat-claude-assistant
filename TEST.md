# 测试清单

## 自动化测试

当前可直接运行：

```bash
npm test
```

当前自动化测试覆盖：

- 安装默认值与帮助文案
- channels 配置与帮助文案
- 二维码页面渲染
- doctor 基础检查
- launchd plist 生成
- worker / channels 独立 sync 状态
- channel bridge 权限流转
- worker prompt 生成
- worker 命令解析
- task manager 成功 / 失败 / 并发保护
- 网页 URL 抓取与内容预处理
- 文件附件下载与文档预览提取
- fake Claude runner 成功 / 失败路径

## 当前自动化基线

- `npm test`
- `94 / 94` 通过

## 最小人工验收清单

不是每次改动都需要做全量人工联调。

只有改到这些真实运行链路时，才建议补一次人工 smoke test：

- 微信登录 / 轮询
- `worker` 执行链路
- 多模态输入
- URL 内容抓取
- 文档附件解析
- 会话恢复
- `launchd` / 常驻运行

最小人工清单固定为 4 步：

1. 运行：

```bash
node dist/cli.js status
```

2. 微信发送：

```text
/echo 你好
```

3. 再发一条普通文本任务，例如：

```text
请用一句话告诉我你现在是否工作正常
```

4. 如果本次改动涉及图片、语音、URL 或文件附件，再补一条对应多模态消息

如果这 4 步都正常，通常就足够说明主路径没有被破坏。

如果这次改动准备对外发版，还需要把对应版本的人工验收记录补成通过状态：

- `docs/releases/manual-verification-vX.Y.Z.md`

至少补齐：

- `Status: PASS`
- `Verifier: ...`
- `Verified-at: ...`

## 人工联调清单

### 1. 登录链路

- [ ] `node dist/cli.js login` 能生成可扫码二维码
- [ ] 扫码后本地状态目录保存账号信息
- [ ] 重新运行 `node dist/cli.js status` 能看到已连接微信

### 2. Worker 主路径

- [ ] `node dist/cli.js start` 能启动 worker
- [ ] 微信发送 `/echo 你好` 能收到回复
- [ ] 微信发送真实任务后，能收到最终结果
- [ ] 长任务超过 5 秒时，会补一条简短进度提示
- [ ] 任务完成后，微信能收到最终结果
- [ ] 失败任务能回传错误信息
- [ ] 同一条消息不会出现重复回复
- [ ] 网页链接或公众号文章链接能被正常解读
- [ ] 上传的 `pdf`、`docx`、`xlsx`、`pptx`、`md` 等文件能被正常解读

### 3. 后台与服务

- [ ] `node dist/cli.js start --daemon` 能后台启动
- [ ] `node dist/cli.js status` 能看到 worker PID 和日志路径
- [ ] `node dist/cli.js stop` 能正常停止后台 worker
- [ ] `node dist/cli.js service install` 能正确安装 macOS launchd 服务
- [ ] 重启登录后服务能自动拉起

### 4. 安全与边界

- [ ] 未授权微信用户消息会被忽略
- [ ] 同一会话已有任务运行时，第二个任务会被拒绝
- [ ] `/reset` 在空闲状态下能重置会话
- [ ] `/reset` 在任务运行中会被拒绝

### 5. 高级模式

- [ ] `node dist/cli.js channels setup` 能同步 `.mcp.json`
- [ ] `node dist/cli.js start --mode channels` 能起本地 channels server
- [ ] 在满足 Claude Channels 条件时，微信消息能进入 Claude 会话
- [ ] `yes <id>` / `no <id>` 能回传审批结果

## 边界与压力补充

- [ ] 超长消息（>1000 字）
- [ ] 特殊字符（emoji、换行）
- [ ] 快速连续消息
- [ ] 长时间运行稳定性
- [ ] Token 失效后的恢复体验
