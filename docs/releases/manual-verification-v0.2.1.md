# Manual Verification for v0.2.1

Status: PASS
Verifier: zhoutianyou
Verified-at: 2026-03-27 Asia/Shanghai
Notes: 已完成真实微信侧验收，确认 worker 主链可用，公众号 URL 可正常解读，3Q 章节页按设计正确降级，允许发布。

## Required checks

- [x] node dist/cli.js status
- [x] 微信发送 /echo 你好
- [x] 再发一条普通文本任务
- [x] 如果本次改动涉及图片、语音、URL 或文件附件，再补一条对应多模态消息
