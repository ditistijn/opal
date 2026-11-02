import { useEffect, useMemo, useRef, useState } from "react"
import { Pencil } from "lucide-react"
import type { ArtifactContent } from "@/lib/opencode/types"
import { shikiLanguage } from "@/lib/artifacts"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { highlightCode } from "./highlight"
import type { ArtifactRuntime } from "./types"

export interface ArtifactCodeProps {
  rt: Pick<ArtifactRuntime, "updateArtifact">
  content: ArtifactContent
  activeFile: string
  onActiveFile(path: string): void
  /** Version snapshots are read-only. */
  readOnly?: boolean
}

/** Entry first, then the rest alphabetically. */
export function orderedFiles(content: Pick<ArtifactContent, "files" | "info">): string[] {
  const entry = content.info.entry
  return Object.keys(content.files).sort((a, b) => (a === entry ? -1 : b === entry ? 1 : a.localeCompare(b)))
}

/** Read-only Shiki view with file tabs and an Edit mode (textarea + Save → updateArtifact = new version). */
export function ArtifactCode({ rt, content, activeFile, onActiveFile, readOnly }: ArtifactCodeProps) {
  const files = useMemo(() => orderedFiles(content), [content])
  const path = files.includes(activeFile) ? activeFile : (files[0] ?? "")
  const source = content.files[path] ?? ""
  const [editing, setEditing] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string>()
  const dirty = Object.entries(drafts).some(([p, v]) => content.files[p] !== v)

  useEffect(() => {
    // switching artifacts / versions drops unsaved edits
    setEditing(false)
    setDrafts({})
    setSaveError(undefined)
  }, [content.info.id, readOnly])

  const save = async () => {
    setSaving(true)
    setSaveError(undefined)
    try {
      await rt.updateArtifact(content.info.id, { ...content.files, ...drafts })
      setEditing(false)
      setDrafts({})
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg-artifact">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border pl-2 pr-2">
        <div
          role="tablist"
          aria-label="Files"
          className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
        >
          {files.map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={f === path}
              onClick={() => onActiveFile(f)}
              title={f}
              className={cn(
                "h-7 shrink-0 rounded-md px-2 font-mono text-xs transition-fast",
                f === path ? "bg-bg-inset text-fg" : "text-fg-secondary hover:bg-bg-muted hover:text-fg",
              )}
            >
              {f}
              {drafts[f] !== undefined && drafts[f] !== content.files[f] ? (
                <span className="ml-1 text-accent">•</span>
              ) : null}
            </button>
          ))}
        </div>
        {readOnly ? (
          <span className="shrink-0 text-xs text-fg-muted">Read-only version</span>
        ) : editing ? (
          <div className="flex shrink-0 items-center gap-1">
            {saveError ? (
              <span className="max-w-48 truncate text-xs text-danger" title={saveError}>
                {saveError}
              </span>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditing(false)
                setDrafts({})
                setSaveError(undefined)
              }}
            >
              Cancel
            </Button>
            <Button size="sm" variant="primary" disabled={!dirty || saving} onClick={() => void save()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="ghost" className="shrink-0" onClick={() => setEditing(true)}>
            <Pencil /> Edit
          </Button>
        )}
      </div>
      {editing && !readOnly ? (
        <Editor
          key={path}
          value={drafts[path] ?? source}
          onChange={(v) => setDrafts((d) => ({ ...d, [path]: v }))}
          onSave={() => dirty && !saving && void save()}
        />
      ) : (
        <Highlighted code={source} lang={shikiLanguage(path)} />
      )}
    </div>
  )
}

function Highlighted({ code, lang }: { code: string; lang: string }) {
  const [html, setHtml] = useState<string>()
  useEffect(() => {
    let cancelled = false
    setHtml(undefined)
    highlightCode(code, lang).then(
      (h) => !cancelled && setHtml(h),
      () => undefined,
    )
    return () => {
      cancelled = true
    }
  }, [code, lang])
  return (
    <div className="artifact-code selectable min-h-0 flex-1 overflow-auto" data-testid="artifact-code">
      {html ? (
        <div dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="plain-code text-fg">{code}</pre>
      )}
    </div>
  )
}

function Editor({ value, onChange, onSave }: { value: string; onChange(v: string): void; onSave(): void }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => ref.current?.focus(), [])
  return (
    <textarea
      ref={ref}
      value={value}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      aria-label="Edit file"
      data-testid="artifact-editor"
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "s") {
          e.preventDefault()
          onSave()
        } else if (e.key === "Tab" && !e.shiftKey) {
          e.preventDefault()
          const el = e.currentTarget
          const { selectionStart: a, selectionEnd: b } = el
          const next = el.value.slice(0, a) + "  " + el.value.slice(b)
          onChange(next)
          requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2))
        }
      }}
      className="selectable min-h-0 flex-1 resize-none border-0 bg-bg-artifact px-5 py-3.5 font-mono text-[12.5px] leading-[1.6] text-fg outline-none [tab-size:2]"
    />
  )
}
