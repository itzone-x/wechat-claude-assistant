# Releasing

这个仓库按简化版语义化版本维护。

- `patch`：小修复、稳定性增强、安装体验优化、文档纠错，例如 `v0.1.1`
- `minor`：新增能力，但不破坏已有使用方式，例如 `v0.2.0`
- `major`：有破坏性变更，例如命令、配置或运行方式不兼容

当前主路径是 `worker-first`。只要改动影响了下面这些内容，就应该判断是否需要发版：

- 安装向导
- `worker` 运行稳定性
- 会话恢复
- 消息去重
- 多模态输入
- `launchd` / 常驻运行

## 发版前最少要做的事

```bash
npm test
```

如果改动影响真实链路，建议再补一次人工检查：

1. `node dist/cli.js install`
2. `node dist/cli.js start` 或 `node dist/cli.js service install`
3. 微信发送 `/echo 你好`
4. 视改动类型补测文字、图片、语音或并发场景

## 最省事的方式

仓库已经内置了发布准备命令：

```bash
npm run release:patch
npm run release:minor
npm run release:major
```

如果你想指定发布标题，可以这样跑：

```bash
npm run release:patch -- --title "Stability Update" --slug "stability-update"
```

脚本会自动完成这些事情：

- 更新 `package.json` 和 `package-lock.json`
- 把 `CHANGELOG.md` 里的 `[Unreleased]` 提升成新版本
- 生成 `docs/releases/vX.Y.Z-*.md`
- 生成 `docs/releases/github-release-vX.Y.Z.md`
- 更新 `README.md`、`USAGE.md` 的最新发布说明链接
- 更新 GitHub 元信息里的推荐 release 标题

如果 `[Unreleased]` 为空，脚本默认会中止，避免发一个没有内容的版本。

## 标准发布步骤

1. 运行发布准备命令

```bash
npm run release:patch
```

或：

```bash
npm run release:minor
npm run release:major
```

2. 运行验证

```bash
npm test
```

3. 提交、打 tag、推送

```bash
git add .
git commit -m "Release vX.Y.Z"
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z
```

4. 创建 GitHub Release  
   使用 `docs/releases/github-release-vX.Y.Z.md` 作为正文

## 当前约定

- 小优化和稳定性修复，不要一直堆在“下次再说”
- 只要已经推到 GitHub 且对用户有感知，就尽量落成一个明确版本
- 如果只是仓库整理、措辞微调、私有文档修改，一般不单独发版

## 最近示例

- `v0.1.0`：worker-first 初版可用发布
- `v0.1.1`：稳定性与安装体验更新
