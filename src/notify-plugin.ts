type AnyRecord = Record<string, unknown>

const TITLE = "OpenCode"
const FALLBACK_SESSION_NAME = "opencode"
const FALLBACK_SESSION_ID = "no-session-id"
const DONE_MESSAGE = "会话已结束"
const BLOCKED_MESSAGE = "等待你确认"
const ERROR_MESSAGE = "会话出现错误"
const FALLBACK_TAG = " [fallback]"
const DONE_SOUND = "default"
const BLOCKED_SOUND = "pop"
const ERROR_SOUND = "bottle"
const DEBUG_MODE = "debug"

const doneTypes = new Set(["session.idle", "session.deleted"])
const blockedTypes = new Set(["permission.asked", "permission.updated", "question.asked"])
const errorTypes = new Set(["session.error"])

type SessionNotificationState = {
  round: number
  active: boolean
}

const notified = new Set<string>()
const notificationStates = new Map<string, SessionNotificationState>()
const sessionTitles = new Map<string, string>()

function asRecord(input: unknown): AnyRecord | null {
  if (!input || typeof input !== "object") return null
  return input as AnyRecord
}

function pickString(input: AnyRecord | null, key: string): string | null {
  if (!input) return null
  const value = input[key]
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

async function writeDebugLog(directory: string, mode: unknown, message: string): Promise<void> {
  if (mode !== DEBUG_MODE) return

  try {
    const { appendFile, mkdir } = await import("node:fs/promises")
    const { join } = await import("node:path")
    const logDirectory = join(directory, "tmp", "logs")
    const logPath = join(logDirectory, "debug.log")
    const line = `[${new Date().toISOString()}] ${message}\n`

    await mkdir(logDirectory, { recursive: true })
    await appendFile(logPath, line, "utf8")
  } catch {
    // Ignore debug log errors to avoid breaking opencode runtime.
  }
}

function eventProperties(event: AnyRecord): AnyRecord | null {
  return asRecord(event.properties)
}

function isIdleSessionStatus(event: AnyRecord): boolean {
  if (event.type !== "session.status") return false
  const properties = eventProperties(event)
  const status = asRecord(properties?.status)
  return status?.type === "idle"
}

function isActiveSessionStatus(event: AnyRecord): boolean {
  if (event.type !== "session.status") return false
  const properties = eventProperties(event)
  const status = asRecord(properties?.status)
  return status?.type === "busy" || status?.type === "retry"
}

// 优先按 opencode SDK 事件结构提取 sessionID，避免误取 error.id 等无关字段。
function pickSessionId(event: AnyRecord): string {
  const properties = eventProperties(event)
  const info = asRecord(properties?.info)
  const session = asRecord(event.session)

  return (
    pickString(properties, "sessionID") ??
    pickString(info, "id") ??
    pickString(event, "sessionID") ??
    pickString(session, "id") ??
    FALLBACK_SESSION_ID
  )
}

// 兼容 opencode 事件可能被包装在 input.event 中的场景。
function extractEvent(input: AnyRecord): AnyRecord {
  const event = input.event
  if (event && typeof event === "object") return event as AnyRecord
  return input
}

// 仅关注会触发用户阻塞感知的终态事件。
function isTerminalEvent(event: AnyRecord): boolean {
  const eventType = event.type
  if (typeof eventType !== "string") return false
  if (isIdleSessionStatus(event)) return true
  return doneTypes.has(eventType) || blockedTypes.has(eventType) || errorTypes.has(eventType)
}

// 根据事件类型生成对应通知文案。
function buildNotificationMessage(event: AnyRecord): string | null {
  const eventType = event.type
  if (typeof eventType !== "string") return null

  if (isIdleSessionStatus(event)) return DONE_MESSAGE
  if (blockedTypes.has(eventType)) return BLOCKED_MESSAGE
  if (errorTypes.has(eventType)) return ERROR_MESSAGE
  if (doneTypes.has(eventType)) return DONE_MESSAGE
  return null
}

function pickNotificationSound(event: AnyRecord): string | null {
  const eventType = event.type
  if (typeof eventType !== "string") return null

  if (isIdleSessionStatus(event)) return DONE_SOUND
  if (blockedTypes.has(eventType)) return BLOCKED_SOUND
  if (errorTypes.has(eventType)) return ERROR_SOUND
  if (doneTypes.has(eventType)) return DONE_SOUND
  return null
}

function cacheSessionTitle(event: AnyRecord): void {
  const properties = eventProperties(event)
  const info = asRecord(properties?.info)
  if (!info) return

  const sessionId = pickString(info, "id")
  const sessionTitle = pickString(info, "title")
  if (!sessionId || !sessionTitle) return
  sessionTitles.set(sessionId, sessionTitle)
}

function pickSessionName(event: AnyRecord): string {
  const properties = eventProperties(event)
  const info = asRecord(properties?.info)
  const session = asRecord(event.session)
  const sessionId = pickSessionId(event)

  return (
    pickString(info, "title") ??
    pickString(session, "name") ??
    sessionTitles.get(sessionId) ??
    FALLBACK_SESSION_NAME
  )
}

function ensureNotificationState(sessionId: string): SessionNotificationState {
  const existing = notificationStates.get(sessionId)
  if (existing) return existing

  const created = { round: 0, active: false }
  notificationStates.set(sessionId, created)
  return created
}

function activateNotificationRound(event: AnyRecord): boolean {
  if (!isActiveSessionStatus(event)) return false

  const sessionId = pickSessionId(event)
  const state = ensureNotificationState(sessionId)
  if (state.active) return false

  state.round += 1
  state.active = true
  return true
}

function buildNotificationKey(event: AnyRecord): string {
  const sessionId = pickSessionId(event)
  const state = ensureNotificationState(sessionId)
  return `${sessionId}:${state.round}`
}

function completeNotificationRound(event: AnyRecord): void {
  const sessionId = pickSessionId(event)
  const state = ensureNotificationState(sessionId)
  state.active = false
}

function escapeAppleScriptText(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

async function notifyByAppleScript(subtitle: string, message: string): Promise<void> {
  const escapedMessage = escapeAppleScriptText(message)
  const escapedSubtitle = escapeAppleScriptText(subtitle)
  const script = `display notification "${escapedMessage}" with title "${TITLE}" subtitle "${escapedSubtitle}"`

  const { execFile } = await import("node:child_process")
  await new Promise<void>((resolve, reject) => {
    execFile("osascript", ["-e", script], (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function buildTerminalNotifierArgs(subtitle: string, message: string, sound: string): string[] {
  return [
    "-title",
    TITLE,
    "-subtitle",
    subtitle,
    "-message",
    message,
    "-sound",
    sound,
    "-activate",
    "com.googlecode.iterm2",
  ]
}

async function notifyByTerminalNotifier(subtitle: string, message: string, sound: string): Promise<boolean> {
  const { execFile } = await import("node:child_process")
  return await new Promise<boolean>((resolve) => {
    execFile("terminal-notifier", buildTerminalNotifierArgs(subtitle, message, sound), (error) => {
      resolve(!error)
    })
  })
}

// 优先使用 terminal-notifier，失败后回退到 AppleScript。
async function notify(subtitle: string, message: string, sound: string): Promise<void> {
  const usedTerminalNotifier = await notifyByTerminalNotifier(subtitle, message, sound)
  if (usedTerminalNotifier) return
  await notifyByAppleScript(subtitle, toFallbackMessage(message))
}

function toFallbackMessage(message: string): string {
  return `${message}${FALLBACK_TAG}`
}

export async function NotifySessionEndPlugin(
  pluginInput: { directory: string },
  options?: Record<string, unknown>,
) {
  const mode = pickString(asRecord(options ?? null), "mode")

  await writeDebugLog(pluginInput.directory, mode, "调试日志已启用")

  return {
    // 插件主入口：消费事件总线并按需发送通知。
    event: async (input: AnyRecord) => {
      const event = extractEvent(input)
      const eventType = typeof event.type === "string" ? event.type : "unknown"
      const sessionId = pickSessionId(event)
      const sessionName = pickSessionName(event)

      if (activateNotificationRound(event)) {
        const state = ensureNotificationState(sessionId)
        await writeDebugLog(pluginInput.directory, mode, `进入新的通知轮次：${sessionId}#${state.round}`)
      }

      await writeDebugLog(
        pluginInput.directory,
        mode,
        `收到事件：${eventType}，会话ID：${sessionId}，会话名：${sessionName}`,
      )

      cacheSessionTitle(event)
      if (!isTerminalEvent(event)) {
        await writeDebugLog(pluginInput.directory, mode, `忽略非终态事件：${eventType}`)
        return
      }

      const message = buildNotificationMessage(event)
      if (!message) {
        await writeDebugLog(pluginInput.directory, mode, `未生成通知文案：${eventType}`)
        return
      }
      const sound = pickNotificationSound(event)
      if (!sound) {
        await writeDebugLog(pluginInput.directory, mode, `未匹配通知音效：${eventType}`)
        return
      }

      const dedupeKey = buildNotificationKey(event)

      if (notified.has(dedupeKey)) {
        await writeDebugLog(pluginInput.directory, mode, `忽略重复通知：${dedupeKey}`)
        return
      }
      notified.add(dedupeKey)
      completeNotificationRound(event)

      try {
        await writeDebugLog(
          pluginInput.directory,
          mode,
          `准备发送通知：事件=${eventType}，轮次键=${dedupeKey}，文案=${message}，音效=${sound}`,
        )
        await notify(sessionName, message, sound)
        await writeDebugLog(pluginInput.directory, mode, `通知发送完成：${dedupeKey}`)
      } catch {
        await writeDebugLog(pluginInput.directory, mode, `通知发送失败：${dedupeKey}`)
        // Ignore notification errors to avoid breaking opencode runtime.
      }
    },
  }
}

export const __test__ = {
  extractEvent,
  pickSessionName,
  pickSessionId,
  isTerminalEvent,
  buildNotificationMessage,
  pickNotificationSound,
  buildTerminalNotifierArgs,
  writeDebugLog,
  buildNotificationKey,
  activateNotificationRound,
  isActiveSessionStatus,
  toFallbackMessage,
  escapeAppleScriptText,
  cacheSessionTitle,
}
