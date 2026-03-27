# Manual Verification for v0.2.0

Status: PENDING
Verifier:
Verified-at:
Notes:

## Required checks

- [ ] node dist/cli.js status
- [ ] 微信发送 /echo 你好
- [ ] 再发一条普通文本任务
- [ ] 发送一个普通网页链接并确认能正常解读
- [ ] 发送一个公众号文章链接并确认能正常解读
- [ ] 上传一个文件附件，例如 `pdf`、`md`、`docx`、`xlsx` 或 `pptx`
- [ ] 如果本次改动涉及图片、语音、URL 或文件附件，再补一条对应多模态消息
