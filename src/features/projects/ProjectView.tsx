import { ArrowLeft, Ellipsis, MessageSquare, Pencil, Trash2 } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { startChat } from "@/features/chat/HomeView"
import { useNav } from "@/features/chat/nav-store"
import { Composer } from "@/features/composer/Composer"
import { sessionTitle } from "@/features/sidebar/group-sessions"
import { RenameInput } from "@/features/sidebar/SessionRow"
import type { ModelRef } from "@/lib/opencode/types"
import { runtime, type ModeID } from "@/lib/runtime"
import { formatRelativeTime } from "@/lib/utils"
import { KnowledgePanel } from "./KnowledgePanel"

/** A project's page: header, composer for a new chat in the project, its chats, knowledge panel. */
export function ProjectView({ projectID }: { projectID: string }) {
  const settings = runtime.useSettings()
  const project = settings.projects.find((p) => p.id === projectID)
  const sessions = runtime.useSessions({ surface: "chat", projectID })
  const go = useNav((s) => s.go)
  const [mode, setMode] = useState<ModeID | undefined>()
  const [model, setModel] = useState<ModelRef | undefined>()
  const [renaming, setRenaming] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (!project) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-fg-muted">
        <p className="text-[14px]">This project no longer exists.</p>
        <Button variant="outline" onClick={() => go({ kind: "projects" })}>
          All projects
        </Button>
      </div>
    )
  }

  const effectiveMode = mode ?? project.defaultMode ?? settings.defaultMode
  const effectiveModel = model ?? project.defaultModel ?? settings.defaultModel

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-8 px-6 pb-16 pt-6 lg:flex-row lg:gap-10">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => go({ kind: "projects" })}
            className="-ml-2 flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] text-fg-muted transition-fast hover:bg-bg-muted hover:text-fg"
          >
            <ArrowLeft className="size-3.5" />
            All projects
          </button>
          <div className="mt-5 flex items-start gap-2">
            {renaming ? (
              <div className="w-80">
                <RenameInput
                  initial={project.name}
                  onDone={(t) => {
                    setRenaming(false)
                    if (t?.trim())
                      void runtime.saveProject({ ...project, name: t.trim(), updated: Date.now() })
                  }}
                />
              </div>
            ) : (
              <h1 className="min-w-0 flex-1 font-serif text-[28px] font-normal leading-tight text-fg">
                {project.name}
              </h1>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Project options"
                  className="mt-1 flex size-8 items-center justify-center rounded-md text-fg-muted transition-fast hover:bg-bg-muted hover:text-fg"
                >
                  <Ellipsis className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setTimeout(() => setRenaming(true), 0)}>
                  <Pencil />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem destructive onSelect={() => setConfirmDelete(true)}>
                  <Trash2 />
                  Delete project
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {project.description ? (
            <p className="mt-1.5 text-[14px] text-fg-secondary">{project.description}</p>
          ) : null}

          <div className="mt-6">
            <Composer
              draftKey={`project:${project.id}`}
              projectID={project.id}
              mode={effectiveMode}
              onModeChange={setMode}
              model={effectiveModel}
              onModelChange={setModel}
              onSubmit={(input) =>
                startChat(input, { projectID: project.id, mode: effectiveMode, model: effectiveModel })
              }
            />
          </div>

          <section className="mt-8" aria-label="Project chats">
            {sessions.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border-strong px-4 py-8 text-center text-[13.5px] text-fg-muted">
                Start a chat to keep conversations organized and re-use project knowledge.
              </p>
            ) : (
              <ul className="divide-y divide-border border-y border-border">
                {sessions.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => go({ kind: "session", sessionID: s.id })}
                      className="flex w-full items-center gap-3 px-1 py-3 text-left transition-fast hover:bg-bg-muted/60"
                    >
                      <MessageSquare className="size-4 shrink-0 text-fg-muted" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] text-fg">{sessionTitle(s)}</span>
                        <span className="block text-[12px] text-fg-muted">
                          Last message {formatRelativeTime(s.time.updated).toLowerCase()}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <KnowledgePanel project={project} />
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent hideClose>
          <DialogTitle>Delete project?</DialogTitle>
          <DialogDescription>
            “{project.name}” and its knowledge files will be deleted. Chats in the project are kept.
          </DialogDescription>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmDelete(false)
                void runtime.deleteProject(project.id)
                go({ kind: "projects" })
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
