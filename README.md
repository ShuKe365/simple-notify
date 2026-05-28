# simple-notify

`simple-notify` 是一个 opencode 插件。当会话进入关键节点时，它会发送 macOS 系统通知：

- 正常结束（`session.idle`、`session.deleted`、`session.status` 且 `status.type === "idle"`）
- 等待用户确认（`permission.asked`、`permission.updated`、`question.asked`）
- 异常退出（`session.error`）

## 在 opencode 中安装

将以下插件配置添加到 opencode 配置文件：

```json
{
  "plugin": [
    "simple-notify@git+ssh://git@github.com/ShuKe365/simple-notify.git#main"
  ]
}
```

如果你的环境不支持 SSH，可使用 HTTPS：

```json
{
  "plugin": [
    "simple-notify@git+https://github.com/ShuKe365/simple-notify.git#main"
  ]
}
```

opencode tui 内置 Bun，会根据仓库配置自动安装依赖并从源码构建。

## 通知行为

- 标题：`OpenCode`
- 文案：
  - `会话已结束`
  - `等待你确认`
  - `会话出现错误`
- 音效：
  - 正常结束：`default`
  - 等待用户确认：`pop`
  - 异常退出：`bottle`
- 会话名缺失时回退为：`opencode`

插件会优先尝试 `terminal-notifier`，失败时回退到 AppleScript（`osascript`）。

## 本地开发

```bash
bun install
bun run test
bun run build
```

## 项目结构

- `src/index.ts`：插件实现与导出 hooks
- `test/notify-plugin.test.ts`：行为测试

## 说明

- `.opencode/` 仅用于本地环境，已明确忽略。
- 本仓库仅发布源代码，不提交构建产物。
