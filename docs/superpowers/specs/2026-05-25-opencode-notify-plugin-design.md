# opencode session 结束通知插件设计

## 目标

开发一个可直接放到 `~/.config/opencode/plugin/` 的单文件 TypeScript 插件：当 session 结束（成功/失败/中断）时，触发 macOS 系统通知。

## 固定输出

- 通知标题：`opencode tui`
- 通知正文：`<session名>:已完成`
- session 名缺失时使用：`opencode`

## 方案（采用推荐方案）

采用“事件总线兜底监听”：实现插件 `event(input)` hook，监听所有事件并通过关键词判断是否为 session 终止事件。

### 核心组件

1. 终止事件识别
   - 将事件对象序列化为字符串并转小写。
   - 匹配关键词：`session.completed/session.finished/session.failed/session.cancel/session.aborted/chat.completed/chat.finished` 等。

2. 会话信息提取
   - 递归遍历浅层对象（深度上限 4），提取 `sessionName/session_name/name/title`。
   - 提取 `sessionId/session_id/id` 作为去重键的一部分。

3. 去重策略
   - 以内存 `Set` 保存 `sessionId:sessionName`，防止同一会话多次结束事件重复通知。

4. 通知发送
   - 使用 `osascript -e 'display notification ... with title ...'`。
   - 发送异常吞掉，不影响 opencode 主流程。

## 错误处理

- 事件字段不稳定：通过“字符串关键词 + 递归字段提取”做兼容。
- 通知命令失败：捕获并忽略，避免影响会话执行。

## 测试策略

使用 `node:test` 做最小可复用单元测试：

1. 能识别终止事件。
2. 能忽略非终止事件。
3. 能提取 session 名并在缺失时回退 `opencode`。
4. 能提取 session id 并在缺失时回退默认值。
