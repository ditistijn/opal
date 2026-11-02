import { Plus, Upload, X } from "lucide-react"
import { useRef, useState } from "react"
import { fileIcon } from "@/features/composer/AttachmentChip"
import { fileToDropped, formatBytes } from "@/features/composer/drafts"
import { ModePicker } from "@/features/composer/ModePicker"
import { ModelSelector } from "@/features/models/ModelSelector"
import { runtime, type Project } from "@/lib/runtime"
import { cn } from "@/lib/utils"
import { InstructionsDialog } from "./InstructionsDialog"

/** Right column of a project page: instructions, knowledge files (drop zone), defaults. */
export function KnowledgePanel({ project }: { project: Project }) {
  const [editing, setEditing] = useState(false)
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const save = (patch: Partial<Project>) => runtime.saveProject({ ...project, ...patch, updated: Date.now() })
  const addFiles = async (files: File[]) => {
    if (!files.length) return
    await runtime.addProjectKnowledge(project.id, await Promise.all(files.map(fileToDropped)))
  }

  return (
    <aside className="w-full space-y-3 lg:w-[300px] lg:shrink-0" aria-label="Project knowledge">
      <section className="rounded-xl border border-border bg-bg-elevated/60 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[13.5px] font-medium text-fg">Instructions</h2>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-md px-2 py-0.5 text-[12.5px] text-fg-secondary transition-fast hover:bg-bg-muted hover:text-fg"
          >
            {project.instructions ? "Edit" : "Add"}
          </button>
        </div>
        <p
          className={cn(
            "mt-1.5 line-clamp-4 text-[13px] leading-relaxed",
            project.instructions ? "text-fg-secondary" : "text-fg-muted",
          )}
        >
          {project.instructions || "Add instructions to tailor Opal's responses in this project."}
        </p>
      </section>

      <section
        className={cn(
          "rounded-xl border bg-bg-elevated/60 p-4 transition-colors duration-[120ms]",
          over ? "border-accent bg-accent-soft" : "border-border",
        )}
        data-drop-zone={`knowledge:${project.id}`}
        // The chat column's drop handler routes drops on this zone to addProjectKnowledge.
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={() => setOver(false)}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[13.5px] font-medium text-fg">Files</h2>
          <button
            type="button"
            aria-label="Add knowledge files"
            onClick={() => input.current?.click()}
            className="flex size-6 items-center justify-center rounded-md text-fg-secondary transition-fast hover:bg-bg-muted hover:text-fg"
          >
            <Plus className="size-4" />
          </button>
          <input
            ref={input}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
              e.target.value = ""
              void addFiles(files)
            }}
          />
        </div>
        {project.knowledge.length ? (
          <ul className="mt-2 space-y-0.5" aria-label="Knowledge files">
            {project.knowledge.map((k) => {
              const Icon = fileIcon(k.name)
              return (
                <li
                  key={k.path}
                  className="group/k -mx-1.5 flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-bg-muted"
                >
                  <Icon className="size-4 shrink-0 text-fg-muted" />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-fg">{k.name}</span>
                  <span className="text-[11.5px] text-fg-muted group-hover/k:hidden">
                    {formatBytes(k.size)}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${k.name}`}
                    onClick={() => save({ knowledge: project.knowledge.filter((x) => x.path !== k.path) })}
                    className="hidden size-5 items-center justify-center rounded-sm text-fg-muted hover:text-fg group-hover/k:flex"
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              )
            })}
          </ul>
        ) : null}
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="mt-3 flex w-full flex-col items-center gap-1 rounded-lg border border-dashed border-border-strong px-3 py-4 text-center text-[12.5px] text-fg-muted transition-fast hover:bg-bg-muted hover:text-fg-secondary"
        >
          <Upload className="size-4" />
          Drop files here or browse
        </button>
      </section>

      <section className="rounded-xl border border-border bg-bg-elevated/60 p-4">
        <h2 className="text-[13.5px] font-medium text-fg">Defaults for new chats</h2>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <ModePicker value={project.defaultMode} onChange={(m) => save({ defaultMode: m })} />
          <ModelSelector value={project.defaultModel} onChange={(m) => save({ defaultModel: m })} compact />
        </div>
      </section>

      <InstructionsDialog
        open={editing}
        onOpenChange={setEditing}
        initial={project.instructions ?? ""}
        projectName={project.name}
        onSave={(text) => save({ instructions: text.trim() || undefined })}
      />
    </aside>
  )
}
