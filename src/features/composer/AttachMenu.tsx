import { FolderClosed, Paperclip, Plus } from "lucide-react"
import { useRef } from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tip } from "@/components/ui/tooltip"
import { runtime, type DroppedFile } from "@/lib/runtime"
import { fileIcon } from "./AttachmentChip"
import { fileToDropped } from "./drafts"

/** The composer's "+" menu: upload files, or add a knowledge file from the conversation's project. */
export function AttachMenu({
  projectID,
  onFiles,
}: {
  projectID?: string
  onFiles(files: DroppedFile[]): void
}) {
  const input = useRef<HTMLInputElement>(null)
  const settings = runtime.useSettings()
  const project = projectID ? settings.projects.find((p) => p.id === projectID) : undefined
  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        data-testid="file-input"
        onChange={async (e) => {
          const list = Array.from(e.target.files ?? [])
          e.target.value = ""
          onFiles(await Promise.all(list.map(fileToDropped)))
        }}
      />
      <DropdownMenu>
        <Tip label="Add files">
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Add files"
              className="flex size-8 items-center justify-center rounded-lg border border-border text-fg-secondary transition-fast hover:bg-bg-muted hover:text-fg data-[state=open]:bg-bg-muted"
            >
              <Plus className="size-4" />
            </button>
          </DropdownMenuTrigger>
        </Tip>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuItem onSelect={() => input.current?.click()}>
            <Paperclip />
            Upload a file
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={!project?.knowledge.length}>
              <FolderClosed />
              Add from project
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
              {project?.knowledge.map((k) => {
                const Icon = fileIcon(k.name)
                return (
                  <DropdownMenuItem
                    key={k.path}
                    onSelect={() => onFiles([{ name: k.name, path: k.path, size: k.size }])}
                  >
                    <Icon />
                    <span className="truncate">{k.name}</span>
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
