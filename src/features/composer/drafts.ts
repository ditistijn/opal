/**
 * Per-conversation composer drafts. Text persists in localStorage; attached files live in
 * memory only (they can hold bytes) until sent.
 */
import { create } from "zustand"
import type { DroppedFile } from "@/lib/runtime"

export interface DraftFile extends DroppedFile {
  id: string
  /** Object URL for image thumbnails (revoked on removal). */
  previewURL?: string
}

const KEY = "opal.drafts"

function load(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, string>
  } catch {
    return {}
  }
}

function save(text: Record<string, string>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(text))
  } catch {}
}

interface DraftState {
  text: Record<string, string>
  files: Record<string, DraftFile[]>
  setText(key: string, text: string): void
  addFiles(key: string, files: DroppedFile[]): void
  removeFile(key: string, id: string): void
  clear(key: string): void
  /** Move a draft (e.g. home → newly created session). */
  move(from: string, to: string): void
}

let counter = 0
const EMPTY: DraftFile[] = []
export const EMPTY_FILES = EMPTY

function toDraft(f: DroppedFile): DraftFile {
  let previewURL: string | undefined
  if (f.bytes && f.mime?.startsWith("image/") && typeof URL.createObjectURL === "function") {
    previewURL = URL.createObjectURL(new Blob([f.bytes as BlobPart], { type: f.mime }))
  }
  return { ...f, id: `f${++counter}`, previewURL }
}

export const useDrafts = create<DraftState>((set) => ({
  text: typeof localStorage !== "undefined" ? load() : {},
  files: {},
  setText(key, value) {
    set((s) => {
      const text = { ...s.text }
      if (value) text[key] = value
      else delete text[key]
      save(text)
      return { text }
    })
  },
  addFiles(key, files) {
    if (!files.length) return
    set((s) => ({ files: { ...s.files, [key]: [...(s.files[key] ?? []), ...files.map(toDraft)] } }))
  },
  removeFile(key, id) {
    set((s) => {
      const f = s.files[key]?.find((x) => x.id === id)
      if (f?.previewURL) URL.revokeObjectURL(f.previewURL)
      return { files: { ...s.files, [key]: (s.files[key] ?? []).filter((x) => x.id !== id) } }
    })
  },
  clear(key) {
    set((s) => {
      const text = { ...s.text }
      delete text[key]
      save(text)
      return { text, files: { ...s.files, [key]: EMPTY } }
    })
  },
  move(from, to) {
    set((s) => {
      const text = { ...s.text }
      if (text[from]) text[to] = text[from]
      delete text[from]
      save(text)
      return { text, files: { ...s.files, [to]: s.files[from] ?? EMPTY, [from]: EMPTY } }
    })
  },
}))

/** Reads a browser File into a DroppedFile with bytes. */
export async function fileToDropped(file: File): Promise<DroppedFile> {
  const buf = new Uint8Array(await file.arrayBuffer())
  return { name: file.name || "pasted-image.png", mime: file.type || undefined, size: file.size, bytes: buf }
}

export function formatBytes(n: number | undefined) {
  if (n === undefined) return ""
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
