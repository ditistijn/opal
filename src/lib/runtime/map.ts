/**
 * Pure mapping from persisted OpenCode messages (`message.list`) to Opal's ChatMessage.
 * The live counterpart (events → ChatMessage) is ./projection.ts; both must agree.
 */
import type { AssistantContent, SessionMessage } from "@/lib/opencode/types"
import type { AttachmentRef, ChatMessage, MessagePart, ToolPart, ToolStatus } from "./contracts"

type Json = Record<string, unknown>
type ToolContentItem =
  { type: "text"; text: string } | { type: "file"; uri: string; mime: string; name?: string | null }

/** Opal's own data on a user message (`metadata.opal`), written by sendPrompt. */
export interface OpalPromptMetadata {
  /** The text the user typed (the prompt text sent to the model may carry an attachment appendix). */
  text?: string
  attachments?: AttachmentRef[]
}

export function readPromptMetadata(metadata: Json | undefined): OpalPromptMetadata {
  const opal = metadata?.opal
  return opal && typeof opal === "object" ? (opal as OpalPromptMetadata) : {}
}

export function toolOutput(content: readonly ToolContentItem[] | undefined): string | undefined {
  if (!content?.length) return undefined
  return content
    .map((item) => (item.type === "text" ? item.text : `[file ${item.name ?? item.uri}]`))
    .join("\n")
}

/** Parses tool input JSON; partial (streaming) JSON yields undefined. */
export function parseToolInput(text: string): Record<string, unknown> | undefined {
  if (!text.trim()) return undefined
  try {
    const value: unknown = JSON.parse(text)
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

function base64Size(data: string) {
  return Math.floor((data.length * 3) / 4) - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0)
}

type UserFile = NonNullable<Extract<SessionMessage, { type: "user" }>["files"]>[number]

export function attachmentFromFile(file: UserFile): AttachmentRef {
  const uri = file.source.type === "uri" ? file.source.uri : `data:${file.mime};base64,${file.data}`
  return { name: file.name ?? "attachment", mime: file.mime, uri, size: base64Size(file.data) }
}

/** Builds user-message attachments: media sent as files + non-media files recorded in metadata. */
export function userAttachments(files: readonly UserFile[] | undefined, metadata: Json | undefined) {
  const list = [...(files ?? []).map(attachmentFromFile), ...(readPromptMetadata(metadata).attachments ?? [])]
  return list.length ? list : undefined
}

export function userText(text: string, metadata: Json | undefined) {
  const original = readPromptMetadata(metadata).text
  return typeof original === "string" ? original : text
}

export function mapToolPart(item: Extract<AssistantContent, { type: "tool" }>): ToolPart {
  const state = item.state
  const status: ToolStatus = state.status
  const part: ToolPart = {
    type: "tool",
    id: item.id,
    name: item.name,
    status,
    time: { created: item.time.created, completed: item.time.completed },
  }
  if (state.status === "streaming") {
    part.inputText = state.input
    part.input = parseToolInput(state.input)
  } else {
    part.input = state.input as Record<string, unknown>
    if (state.metadata) part.metadata = state.metadata as Record<string, unknown>
  }
  if (state.status === "completed" || state.status === "error") part.output = toolOutput(state.content)
  if (state.status === "error") part.error = state.error.message
  return part
}

export function mapContent(content: readonly AssistantContent[], streaming: boolean): MessagePart[] {
  return content.map((item): MessagePart => {
    if (item.type === "text")
      return streaming ? { type: "text", text: item.text, streaming } : { type: "text", text: item.text }
    if (item.type === "reasoning") {
      const done = !!item.time?.completed || !streaming
      return { type: "reasoning", text: item.text, streaming: !done, time: item.time }
    }
    return mapToolPart(item)
  })
}

function textPart(text: string): MessagePart[] {
  return text ? [{ type: "text", text }] : []
}

/**
 * Maps one persisted message. Returns undefined for transcript markers the chat UI does not render
 * (model/agent/location switches, instruction updates, successful idle markers).
 */
export function mapMessage(message: SessionMessage, sessionID: string): ChatMessage | undefined {
  const base = { id: message.id, sessionID, kind: message.type, created: message.time.created }
  switch (message.type) {
    case "user":
      return {
        ...base,
        role: "user",
        parts: textPart(userText(message.text, message.metadata)),
        attachments: userAttachments(message.files, message.metadata),
      }
    case "assistant": {
      const streaming = message.time.completed === undefined
      return {
        ...base,
        role: "assistant",
        parts: mapContent(message.content, streaming),
        model: message.model,
        agent: message.agent,
        completed: message.time.completed,
        streaming: streaming || undefined,
        error: message.error?.message,
        tokens: message.tokens,
        cost: message.cost,
        changedFiles: message.snapshot?.files,
      }
    }
    case "synthetic":
    case "skill":
      return { ...base, role: "system", parts: textPart(message.text) }
    case "shell": {
      const output = message.output?.output ?? ""
      return {
        ...base,
        role: "system",
        parts: textPart(`$ ${message.command}${output ? `\n${output}` : ""}`),
      }
    }
    case "compaction":
      if (message.status === "failed")
        return { ...base, role: "system", parts: [], error: message.error.message }
      return {
        ...base,
        role: "system",
        parts: textPart(message.summary),
        streaming: message.status === "running" || undefined,
      }
    case "idle":
      if (message.outcome === "succeeded") return undefined
      return {
        ...base,
        role: "system",
        parts: [],
        error: message.error?.message ?? (message.outcome === "interrupted" ? "Interrupted" : "Failed"),
      }
    default:
      return undefined
  }
}

export function mapMessages(messages: readonly SessionMessage[], sessionID: string): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const message of messages) {
    const mapped = mapMessage(message, sessionID)
    if (mapped) out.push(mapped)
  }
  return out
}
