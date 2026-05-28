# AGENTS

## 目标

保证该插件在 opencode 通过 GitHub 远程加载时稳定可用。

## 规则

1. 不要提交 `.opencode/`。
2. 仓库保持仅源码发布；不要提交 `dist/`。
3. 通知行为发生变更时，必须在 `test/notify-plugin.test.ts` 中补充测试。
4. 测试产生的临时文件和数据统一放在项目根路径 `tmp/` 下。
5. 合并或发布前必须执行：

```bash
bun run check
```

6. 保持 README 中的安装示例与实际 GitHub URI、插件使用方式一致。
