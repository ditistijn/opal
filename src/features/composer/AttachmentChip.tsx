import { FileCode, FileImage, FileSpreadsheet, FileText, File as FileIcon, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatBytes } from "./drafts"

export function fileIcon(name: string, mime?: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? ""
  if (mime?.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg", "heic"].includes(ext))
    return FileImage
  if (["csv", "xlsx", "xls", "tsv", "numbers"].includes(ext)) return FileSpreadsheet
  if (
    ["ts", "tsx", "js", "jsx", "py", "rs", "go", "json", "html", "css", "sh", "swift", "java"].includes(ext)
  )
    return FileCode
  if (["md", "txt", "pdf", "doc", "docx", "rtf"].includes(ext)) return FileText
  return FileIcon
}

/** A file attached to a draft or a sent message. */
export function AttachmentChip({
  name,
  mime,
  size,
  previewURL,
  onRemove,
  className,
}: {
  name: string
  mime?: string
  size?: number
  previewURL?: string
  onRemove?(): void
  className?: string
}) {
  const Icon = fileIcon(name, mime)
  const ext = name.includes(".") ? name.split(".").pop()!.toUpperCase() : "FILE"
  return (
    <div
      className={cn(
        "group/chip relative flex h-11 max-w-[220px] items-center gap-2 rounded-lg border border-border bg-bg-elevated py-1 pl-1 pr-3",
        className,
      )}
      title={name}
      data-testid="attachment-chip"
    >
      {previewURL ? (
        <img src={previewURL} alt="" className="size-9 shrink-0 rounded-md object-cover" />
      ) : (
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-bg-muted text-fg-muted">
          <Icon className="size-[18px]" />
        </span>
      )}
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-[12.5px] text-fg">{name}</span>
        <span className="text-[11px] text-fg-muted">
          {ext}
          {size !== undefined ? ` · ${formatBytes(size)}` : ""}
        </span>
      </span>
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove ${name}`}
          onClick={onRemove}
          className="absolute -right-1.5 -top-1.5 flex size-[18px] items-center justify-center rounded-full border border-border bg-bg-elevated text-fg-secondary opacity-0 shadow-sm transition-opacity hover:text-fg group-hover/chip:opacity-100 focus-visible:opacity-100"
        >
          <X className="size-3" />
        </button>
      ) : null}
    </div>
  )
}
