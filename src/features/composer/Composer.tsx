import { ArrowUp, Clock, Square } from "lucide-react"
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react"
import { Tip } from "@/components/ui/tooltip"
import { ModelSelector } from "@/features/models/ModelSelector"
import type { ModelRef } from "@/lib/opencode/types"
import type { DroppedFile, ModeID, PromptInput, SessionActivity } from "@/lib/runtime"
import { cn } from "@/lib/utils"
import { AttachMenu } from "./AttachMenu"
import { AttachmentChip } from "./AttachmentChip"
import { EMPTY_FILES, fileToDropped, useDrafts } from "./drafts"
import { ImageFallbackHint } from "./ImageFallbackHint"
import { ModePicker } from "./ModePicker"

export interface ComposerProps {
  /** Draft key: session id, "home", or "project:<id>". Text and attachments are kept per key. */
  draftKey: string
  placeholder?: string
  activity?: SessionActivity
  onSubmit(input: PromptInput): unknown
  onStop?(): void
  sessionID?: string
  projectID?: string
  mode: ModeID | undefined
  onModeChange(mode: ModeID): void
  model?: ModelRef
  onModelChange?(model: ModelRef): void
  autoFocus?: boolean
  /** Rendered above the input inside the composer column (e.g. permission prompts). */
  above?: ReactNode
  className?: string
}

/** Composer: auto-growing textarea, attachments, mode + model pickers, send/stop. */
export function Composer({
  draftKey,
  placeholder = "How can I help you today?",
  activity = "idle",
  onSubmit,
  onStop,
  sessionID,
  projectID,
  mode,
  onModeChange,
  model,
  onModelChange,
  autoFocus,
  above,
  className,
}: ComposerProps) {
  const text = useDrafts((s) => s.text[draftKey] ?? "")
  const files = useDrafts((s) => s.files[draftKey] ?? EMPTY_FILES)
  const { setText, addFiles, removeFile, clear } = useDrafts.getState()
  const ref = useRef<HTMLTextAreaElement>(null)

  const busy = activity === "busy" || activity === "retry"
  const queued = activity === "queued"
  const canSend = !busy && !queued && (text.trim().length > 0 || files.length > 0)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`
  }, [text])

  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus, draftKey])

  const submit = async () => {
    if (!canSend) return
    const input: PromptInput = {
      text: text.trim(),
      files: files.length ? files.map(({ id: _id, previewURL: _p, ...f }) => f as DroppedFile) : undefined,
    }
    clear(draftKey)
    await onSubmit(input)
  }

  return (
    <div className={cn("w-full", className)}>
      {above}
      <div
        className="rounded-composer bg-bg-elevated shadow-composer transition-shadow duration-[120ms] focus-within:shadow-[0_0_0_1px_var(--border-strong),0_2px_12px_rgba(0,0,0,0.06)]"
        onClick={(e) => {
          if (e.target === e.currentTarget) ref.current?.focus()
        }}
      >
        {files.length ? (
          <div className="flex flex-wrap gap-2 px-3.5 pt-3.5" aria-label="Attachments">
            {files.map((f) => (
              <AttachmentChip
                key={f.id}
                name={f.name}
                mime={f.mime}
                size={f.size}
                previewURL={f.previewURL}
                onRemove={() => removeFile(draftKey, f.id)}
              />
            ))}
          </div>
        ) : null}
        {files.length ? <ImageFallbackHint files={files} sessionID={sessionID} model={model} /> : null}
        <textarea
          ref={ref}
          rows={1}
          value={text}
          aria-label="Message"
          placeholder={placeholder}
          onChange={(e) => setText(draftKey, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void submit()
            }
          }}
          onPaste={async (e) => {
            const pasted = Array.from(e.clipboardData?.files ?? [])
            if (!pasted.length) return
            if (!e.clipboardData.getData("text/plain")) e.preventDefault()
            addFiles(draftKey, await Promise.all(pasted.map(fileToDropped)))
          }}
          className="selectable block max-h-80 min-h-[52px] w-full resize-none bg-transparent px-4 pb-1 pt-4 text-[15px] leading-6 text-fg outline-none placeholder:text-fg-muted focus-visible:outline-none"
        />
        <div className="flex items-center gap-1.5 px-2.5 pb-2.5 pt-1.5">
          <AttachMenu projectID={projectID} onFiles={(f) => addFiles(draftKey, f)} />
          <div className="flex-1" />
          <ModePicker value={mode} onChange={onModeChange} />
          <ModelSelector sessionID={sessionID} value={model} onChange={onModelChange} compact />
          {queued ? (
            <span className="flex items-center gap-1 px-1 text-xs text-fg-muted" role="status">
              <Clock className="size-3.5" />
              Queued
            </span>
          ) : null}
          {busy || queued ? (
            <Tip label={queued ? "Cancel" : "Stop"} shortcut="Esc">
              <button
                type="button"
                aria-label={queued ? "Cancel queued message" : "Stop generating"}
                onClick={onStop}
                className="flex size-8 items-center justify-center rounded-full bg-fg text-bg transition-fast hover:opacity-85"
              >
                <Square className="size-3 fill-current" />
              </button>
            </Tip>
          ) : (
            <button
              type="button"
              aria-label="Send message"
              disabled={!canSend}
              onClick={() => void submit()}
              className="flex size-8 items-center justify-center rounded-full bg-accent text-fg-on-accent transition-fast hover:bg-accent-hover disabled:cursor-default disabled:opacity-40 disabled:hover:bg-accent"
            >
              <ArrowUp className="size-[18px]" strokeWidth={2.4} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
