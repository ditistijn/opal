import { FolderClosed, Plus, Search } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { useNav } from "@/features/chat/nav-store"
import { runtime } from "@/lib/runtime"
import { formatRelativeTime } from "@/lib/utils"
import { NewProjectDialog } from "./NewProjectDialog"

/** "Projects" page: searchable list of all projects. */
export function ProjectsIndex() {
  const settings = runtime.useSettings()
  const go = useNav((s) => s.go)
  const [query, setQuery] = useState("")
  const [creating, setCreating] = useState(false)
  const q = query.trim().toLowerCase()
  const projects = [...settings.projects]
    .filter((p) => !q || p.name.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q))
    .sort((a, b) => b.updated - a.updated)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[var(--content-max-width)] px-6 pb-16 pt-12">
        <div className="flex items-center justify-between">
          <h1 className="font-serif text-[28px] font-normal text-fg">Projects</h1>
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus />
            New project
          </Button>
        </div>
        <div className="relative mt-6">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted" />
          <input
            aria-label="Search projects"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects…"
            className="selectable h-10 w-full rounded-lg border border-border-strong bg-bg-elevated pl-9 pr-3 text-[14px] text-fg outline-none placeholder:text-fg-muted focus:border-accent/60 focus-visible:outline-none"
          />
        </div>
        <ul className="mt-4 divide-y divide-border">
          {projects.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => go({ kind: "project", projectID: p.id })}
                className="-mx-3 flex w-[calc(100%+1.5rem)] items-start gap-3 rounded-lg px-3 py-3.5 text-left transition-fast hover:bg-bg-muted"
              >
                <FolderClosed className="mt-0.5 size-4 shrink-0 text-fg-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-fg">{p.name}</span>
                  {p.description ? (
                    <span className="mt-0.5 block truncate text-[13px] text-fg-secondary">
                      {p.description}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-[12px] text-fg-muted">
                  Updated {formatRelativeTime(p.updated).toLowerCase()}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {projects.length === 0 ? (
          <p className="py-16 text-center text-[13.5px] text-fg-muted">
            {q
              ? "No projects match your search."
              : "Create a project to organize chats with shared knowledge."}
          </p>
        ) : null}
      </div>
      <NewProjectDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(p) => go({ kind: "project", projectID: p.id })}
      />
    </div>
  )
}
