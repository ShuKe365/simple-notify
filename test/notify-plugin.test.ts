import assert from "node:assert/strict"
import { access, chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"

import { __test__, NotifySessionEndPlugin } from "../src/notify-plugin"

test("插件入口导出必须全部为函数", async () => {
  const module = await import("../src/index")
  for (const exported of Object.values(module)) {
    assert.equal(typeof exported, "function")
  }
})

test("识别 session 结束事件", () => {
  const event = { type: "session.idle", session: { name: "demo" } }
  assert.equal(__test__.isTerminalEvent(event), true)
})

test("识别 session 删除事件", () => {
  const event = { type: "session.deleted", session: { name: "demo" } }
  assert.equal(__test__.isTerminalEvent(event), true)
})

test("识别 session.status idle 结束事件", () => {
  const event = { type: "session.status", properties: { sessionID: "s-1", status: { type: "idle" } } }
  assert.equal(__test__.isTerminalEvent(event), true)
})

test("忽略普通中间事件", () => {
  const event = { type: "tool.execute.before", tool: "read" }
  assert.equal(__test__.isTerminalEvent(event), false)
})

test("忽略 session.status busy 中间事件", () => {
  const event = { type: "session.status", properties: { sessionID: "s-1", status: { type: "busy" } } }
  assert.equal(__test__.isTerminalEvent(event), false)
})

test("支持 opencode 的 event 包裹结构", () => {
  const wrapped = { event: { type: "session.error", session: { name: "demo" } } }
  assert.equal(__test__.extractEvent(wrapped).type, "session.error")
})

test("提取 session 名并回退默认值", () => {
  assert.equal(__test__.pickSessionName({ session: { name: "my-session" } }), "my-session")
  assert.equal(__test__.pickSessionName({}), "opencode")
})

test("支持从 opencode 事件 properties.info.title 提取 session 名", () => {
  const event = {
    type: "session.updated",
    properties: { info: { id: "s-prop", title: "任务A" } },
  }
  assert.equal(__test__.pickSessionName(event), "任务A")
})

test("session.idle 通过 sessionID 使用缓存的 session 名", () => {
  __test__.cacheSessionTitle({
    type: "session.updated",
    properties: { info: { id: "s-cache", title: "缓存会话" } },
  })
  const idleEvent = { type: "session.idle", properties: { sessionID: "s-cache" } }
  assert.equal(__test__.pickSessionName(idleEvent), "缓存会话")
})

test("不误用 error.name 作为 session 名", () => {
  const event = {
    type: "session.error",
    properties: { error: { name: "UnknownError" } },
  }
  assert.equal(__test__.pickSessionName(event), "opencode")
})

test("提取 session id 并回退默认值", () => {
  assert.equal(__test__.pickSessionId({ session: { id: "s-1" } }), "s-1")
  assert.equal(__test__.pickSessionId({}), "no-session-id")
})

test("fallback 通知文案追加标记", () => {
  assert.equal(__test__.toFallbackMessage("会话已结束"), "会话已结束 [fallback]")
})

test("permission.asked 触发等待确认通知", () => {
  const event = { type: "permission.asked", session: { name: "my-session" } }
  assert.equal(__test__.buildNotificationMessage(event), "等待你确认")
})

test("permission.updated 触发等待确认通知", () => {
  const event = { type: "permission.updated", properties: { sessionID: "s-1" } }
  assert.equal(__test__.buildNotificationMessage(event), "等待你确认")
})

test("question.asked 触发等待确认通知", () => {
  const event = { type: "question.asked", properties: { sessionID: "s-1" } }
  assert.equal(__test__.isTerminalEvent(event), true)
  assert.equal(__test__.buildNotificationMessage(event), "等待你确认")
  assert.equal(__test__.pickNotificationSound(event), "pop")
})

test("session.error 触发错误通知", () => {
  const event = { type: "session.error", session: { name: "my-session" } }
  assert.equal(__test__.buildNotificationMessage(event), "会话出现错误")
})

test("session.idle 触发结束通知", () => {
  const event = { type: "session.idle", session: { name: "my-session" } }
  assert.equal(__test__.buildNotificationMessage(event), "会话已结束")
})

test("session.status idle 触发结束通知", () => {
  const event = { type: "session.status", properties: { sessionID: "s-1", status: { type: "idle" } } }
  assert.equal(__test__.buildNotificationMessage(event), "会话已结束")
})

test("正常结束事件使用 default 音效", () => {
  const event = { type: "session.status", properties: { sessionID: "s-1", status: { type: "idle" } } }
  assert.equal(__test__.pickNotificationSound(event), "default")
})

test("等待用户确认事件使用 pop 音效", () => {
  const event = { type: "permission.asked", session: { name: "my-session" } }
  assert.equal(__test__.pickNotificationSound(event), "pop")
})

test("异常结束事件使用 bottle 音效", () => {
  const event = { type: "session.error", session: { name: "my-session" } }
  assert.equal(__test__.pickNotificationSound(event), "bottle")
})

test("terminal-notifier 参数包含对应音效", () => {
  assert.deepEqual(__test__.buildTerminalNotifierArgs("opencode", "会话已结束", "default"), [
    "-title",
    "OpenCode",
    "-subtitle",
    "opencode",
    "-message",
    "会话已结束",
    "-sound",
    "default",
    "-activate",
    "com.googlecode.iterm2",
  ])
})

test("mode=debug 时将日志追加写入 tmp/logs/debug.log", async () => {
  const root = await mkdtemp(path.join(process.cwd(), "tmp/notify-plugin-debug-"))

  try {
    await __test__.writeDebugLog(root, "debug", "收到事件：session.error")
    await __test__.writeDebugLog(root, "debug", "忽略重复通知")

    const content = await readFile(path.join(root, "tmp/logs/debug.log"), "utf8")
    assert.match(content, /收到事件：session\.error/)
    assert.match(content, /忽略重复通知/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("非 debug 模式不写入日志文件", async () => {
  const root = await mkdtemp(path.join(process.cwd(), "tmp/notify-plugin-silent-"))

  try {
    await __test__.writeDebugLog(root, "info", "不会写入")

    await assert.rejects(access(path.join(root, "tmp/logs/debug.log")))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("mode=debug 时事件 hook 输出中文调试日志", async () => {
  const root = await mkdtemp(path.join(process.cwd(), "tmp/notify-plugin-hook-"))

  try {
    const plugin = await NotifySessionEndPlugin({ directory: root } as never, { mode: "debug" })
    await plugin.event?.({ event: { type: "tool.execute.before", tool: "read" } } as never)

    const content = await readFile(path.join(root, "tmp/logs/debug.log"), "utf8")
    assert.match(content, /收到事件：tool\.execute\.before/)
    assert.match(content, /忽略非终态事件/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("同一轮结束的多个终态事件只发送一次通知", async () => {
  const root = await mkdtemp(path.join(process.cwd(), "tmp/notify-plugin-dedupe-"))
  const fakeBin = path.join(root, "fake-bin")
  const notifyLog = path.join(root, "notify.log")
  const originalPath = process.env.PATH ?? ""

  try {
    await mkdir(fakeBin, { recursive: true })
    await writeFile(
      path.join(fakeBin, "terminal-notifier"),
      `#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"${notifyLog}\"\n`,
      "utf8",
    )
    await chmod(path.join(fakeBin, "terminal-notifier"), 0o755)
    process.env.PATH = `${fakeBin}:${originalPath}`

    const plugin = await NotifySessionEndPlugin({ directory: root } as never)
    await plugin.event?.({ event: { type: "session.idle", properties: { sessionID: "s-dedupe" }, session: { name: "会话A" } } } as never)
    await plugin.event?.({
      event: {
        type: "session.status",
        properties: { sessionID: "s-dedupe", status: { type: "idle" } },
        session: { name: "会话A" },
      },
    } as never)

    const content = await readFile(notifyLog, "utf8")
    assert.equal(content.trim().split("\n").length, 1)
  } finally {
    process.env.PATH = originalPath
    await rm(root, { recursive: true, force: true })
  }
})

test("同一 session 新一轮开始后结束仍会再次通知", async () => {
  const root = await mkdtemp(path.join(process.cwd(), "tmp/notify-plugin-round-"))
  const fakeBin = path.join(root, "fake-bin")
  const notifyLog = path.join(root, "notify.log")
  const originalPath = process.env.PATH ?? ""

  try {
    await mkdir(fakeBin, { recursive: true })
    await writeFile(
      path.join(fakeBin, "terminal-notifier"),
      `#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"${notifyLog}\"\n`,
      "utf8",
    )
    await chmod(path.join(fakeBin, "terminal-notifier"), 0o755)
    process.env.PATH = `${fakeBin}:${originalPath}`

    const plugin = await NotifySessionEndPlugin({ directory: root } as never)
    await plugin.event?.({ event: { type: "session.idle", properties: { sessionID: "s-round" }, session: { name: "会话A" } } } as never)
    await plugin.event?.({
      event: {
        type: "session.status",
        properties: { sessionID: "s-round", status: { type: "busy" } },
        session: { name: "会话A" },
      },
    } as never)
    await plugin.event?.({
      event: {
        type: "session.status",
        properties: { sessionID: "s-round", status: { type: "idle" } },
        session: { name: "会话A" },
      },
    } as never)

    const content = await readFile(notifyLog, "utf8")
    assert.equal(content.trim().split("\n").length, 2)
  } finally {
    process.env.PATH = originalPath
    await rm(root, { recursive: true, force: true })
  }
})

test("AppleScript 文本转义", () => {
  assert.equal(__test__.escapeAppleScriptText('a\\b"c'), 'a\\\\b\\"c')
})
