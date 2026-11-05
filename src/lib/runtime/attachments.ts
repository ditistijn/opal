/**
 * Prompt attachments.
 *
 * Tauri: dropped files are copied into the conversation's `uploads/` (Rust `cmd_import_uploads`).
 * Images and PDFs are attached as `files: [{ uri: "file://…" }]` (OpenCode reads them from disk —
 * core/session/prompt.ts accepts file: and data: URIs, sniffs the mime type and caps at 20 MB);
 * every other file is referenced in the prompt text by its sandbox path so the agent reads it with
 * its tools. Browser: media becomes data: URIs; small text files are inlined into the prompt.
 */
import { isRasterImage, visionNote } from "@/lib/config/vision"
import { isTauri } from "@/lib/utils"
import type { AttachmentRef, DroppedFile, PromptInput } from "./contracts"
import type { OpalPromptMetadata } from "./map"
import { inlinePayload, native } from "./native"

export interface PreparedPrompt {
  text: string
  files: { uri: string; name: string }[]
  metadata: { opal: OpalPromptMetadata }
  /** Everything the user attached, for the optimistic message. */
  attachments: AttachmentRef[]
}

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
  html: "text/html",
  xml: "application/xml",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip",
}

const INLINE_TEXT_LIMIT = 200 * 1024

export function guessMime(file: Pick<DroppedFile, "name" | "mime">): string | undefined {
  if (file.mime) return file.mime
  const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
  return MIME_BY_EXT[ext]
}

/** Media the model receives as file parts (everything else is referenced by path). */
export function isMedia(mime: string | undefined) {
  return !!mime && mime !== "image/svg+xml" && (mime.startsWith("image/") || mime === "application/pdf")
}

function isText(mime: string | undefined) {
  return !!mime && (mime.startsWith("text/") || mime === "application/json" || mime === "application/xml")
}

export function fileURL(absolutePath: string) {
  return "file://" + absolutePath.split("/").map(encodeURIComponent).join("/")
}

function formatSize(bytes: number | undefined) {
  if (bytes === undefined) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function toBase64(bytes: Uint8Array) {
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** Appends the attachment note the model sees; the UI shows `metadata.opal.text` instead. */
export function withAttachmentNote(text: string, lines: string[], intro: string) {
  if (!lines.length) return text
  return `${text}\n\n<user_attachments>\n${intro}\n${lines.join("\n")}\n</user_attachments>`
}

export interface ImageRouting {
  /** The session's model accepts image input (default true). */
  imageInput?: boolean
  /** The "vision" helper agent exists (src/lib/config/vision.ts). */
  visionHelper?: boolean
}

/**
 * @param uploadKey  conversation folder key (session id) under conversations/
 * @param relativeTo the session directory when it is that conversation folder (paths are then relative)
 * @param routing    when the model can't see images, they are referenced by path for the vision helper
 *                   instead of being sent as file parts
 */
export async function preparePrompt(
  input: PromptInput,
  uploadKey: string,
  relativeTo?: string,
  routing: ImageRouting = {},
): Promise<PreparedPrompt> {
  const blind = routing.imageInput === false
  const dropped = input.files ?? []
  const prepared: PreparedPrompt = {
    text: input.text,
    files: [],
    metadata: { opal: { text: input.text } },
    attachments: [],
  }
  if (!dropped.length) return prepared
  const notes: string[] = []
  const pathAttachments: AttachmentRef[] = []

  if (isTauri()) {
    const byPath = dropped.filter((f) => f.path)
    const byBytes = dropped.filter((f) => !f.path && f.bytes) as (DroppedFile & { bytes: Uint8Array })[]
    const entries = await native.importUploads(
      uploadKey,
      byPath.map((f) => f.path!),
      inlinePayload(byBytes.map((f) => ({ name: f.name, bytes: f.bytes }))),
    )
    let hiddenImages = 0
    ;[...byPath, ...byBytes].forEach((file, i) => {
      const entry = entries[i]
      if (!entry) return
      const mime = guessMime(file)
      const ref: AttachmentRef = { name: file.name, mime, uri: fileURL(entry.path), size: entry.size }
      prepared.attachments.push(ref)
      const hidden = blind && isRasterImage(mime)
      if (hidden) hiddenImages++
      if (isMedia(mime) && !hidden) prepared.files.push({ uri: ref.uri!, name: file.name })
      else {
        pathAttachments.push(ref)
        const shown = relativeTo && entry.path.startsWith(relativeTo + "/") ? entry.name : entry.path
        notes.push(
          `- ${shown}${mime ? ` (${mime}, ${formatSize(entry.size)})` : ` (${formatSize(entry.size)})`}`,
        )
      }
    })
    if (hiddenImages) notes.push("", visionNote(routing.visionHelper === true))
    prepared.text = withAttachmentNote(
      input.text,
      notes,
      "The user attached these files; they are saved in your working folder:",
    )
  } else {
    // LIMITATION: the plain-browser build cannot write into the sandbox; media is sent inline and
    // small text files are inlined into the prompt, larger non-media files are only named. Images have no
    // path the vision helper could read, so they are sent inline even to a model without image input.
    for (const file of dropped) {
      const mime = guessMime(file)
      const size = file.size ?? file.bytes?.length
      if (!file.bytes) {
        notes.push(`- ${file.name} (not readable in the browser build)`)
        continue
      }
      if (isMedia(mime)) {
        const uri = `data:${mime};base64,${toBase64(file.bytes)}`
        prepared.files.push({ uri, name: file.name })
        prepared.attachments.push({ name: file.name, mime, uri, size })
      } else if (isText(mime) && file.bytes.length <= INLINE_TEXT_LIMIT) {
        const content = new TextDecoder().decode(file.bytes)
        notes.push(`- ${file.name}:\n\`\`\`\n${content}\n\`\`\``)
        const ref = { name: file.name, mime, size }
        pathAttachments.push(ref)
        prepared.attachments.push(ref)
      } else {
        notes.push(`- ${file.name} (${formatSize(size)}, content not available)`)
        const ref = { name: file.name, mime, size }
        pathAttachments.push(ref)
        prepared.attachments.push(ref)
      }
    }
    prepared.text = withAttachmentNote(input.text, notes, "The user attached these files:")
  }
  if (pathAttachments.length) prepared.metadata.opal.attachments = pathAttachments
  return prepared
}
