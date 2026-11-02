import type { ReactNode } from "react"
import {
  Check,
  ChevronDown,
  CodeXml,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileArchive,
  FileCode,
  History,
  Maximize2,
  Minimize2,
  Monitor,
  RotateCw,
  Smartphone,
  Tablet,
  X,
} from "lucide-react"
import type { ArtifactInfo } from "@/lib/opencode/types"
import type { ArtifactKind, ArtifactVersion } from "@/lib/runtime/contracts"
import { detectKind, kindLabel, PREVIEW_SIZES, type PreviewSizeID } from "@/lib/artifacts"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tip } from "@/components/ui/tooltip"
import { cn, formatRelativeTime } from "@/lib/utils"

export type PanelMode = "preview" | "code"

export interface ArtifactHeaderProps {
  info: ArtifactInfo
  kind: ArtifactKind
  artifacts: ArtifactInfo[]
  onSelectArtifact(id: string): void
  mode: PanelMode
  onMode(mode: PanelMode): void
  versions: ArtifactVersion[]
  /** undefined = live (latest). */
  version?: number
  onVersion(n: number | undefined): void
  size: PreviewSizeID
  onSize(size: PreviewSizeID): void
  onRefresh(): void
  copied: boolean
  onCopy(): void
  fileCount: number
  onDownloadHTML(): void
  onDownloadFiles(): void
  onOpenInBrowser(): void
  fullscreen: boolean
  onFullscreen(): void
  onClose(): void
}

const SIZE_ICON = { desktop: Monitor, tablet: Tablet, mobile: Smartphone } as const

function IconButton({
  label,
  shortcut,
  children,
  ...props
}: { label: string; shortcut?: string; children: ReactNode } & React.ComponentProps<typeof Button>) {
  return (
    <Tip label={label} shortcut={shortcut} side="bottom">
      <Button size="icon-sm" variant="ghost" aria-label={label} {...props}>
        {children}
      </Button>
    </Tip>
  )
}

export function ArtifactHeader(p: ArtifactHeaderProps) {
  const latest = p.versions.length ? Math.max(...p.versions.map((v) => v.n)) : undefined
  const shown = p.version ?? latest
  const shownTime =
    p.version !== undefined ? p.versions.find((v) => v.n === p.version)?.time : p.info.time.updated
  const SizeIcon = SIZE_ICON[p.size]
  const multiple = p.artifacts.length > 1

  return (
    <div
      className="@container flex h-11 shrink-0 items-center gap-2 border-b border-border bg-bg px-2"
      data-testid="artifact-header"
    >
      <div
        role="tablist"
        aria-label="View"
        className="flex shrink-0 items-center rounded-md bg-bg-muted p-0.5"
      >
        {(
          [
            ["preview", "Preview", Eye],
            ["code", "Code", CodeXml],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={p.mode === id}
            aria-label={label}
            onClick={() => p.onMode(id)}
            className={cn(
              "flex h-6 items-center gap-1.5 rounded-[5px] px-2 text-xs font-medium transition-fast",
              p.mode === id ? "bg-bg-elevated text-fg shadow-sm" : "text-fg-secondary hover:text-fg",
            )}
          >
            <Icon className="size-3.5" />
            <span className="hidden @[520px]:inline">{label}</span>
          </button>
        ))}
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        {multiple ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                data-testid="artifact-switcher"
                className="flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-left transition-fast hover:bg-bg-muted"
              >
                <span className="truncate text-sm font-medium text-fg">
                  {p.info.title || "Untitled artifact"}
                </span>
                <ChevronDown className="size-3.5 shrink-0 text-fg-muted" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              <DropdownMenuLabel>Artifacts in this chat</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={p.info.id} onValueChange={p.onSelectArtifact}>
                {[...p.artifacts]
                  .sort((a, b) => b.time.updated - a.time.updated)
                  .map((a) => (
                    <DropdownMenuRadioItem key={a.id} value={a.id} className="h-auto py-1.5">
                      <div className="min-w-0">
                        <div className="truncate">{a.title || "Untitled artifact"}</div>
                        <div className="text-[11.5px] text-fg-muted">
                          {kindLabel(detectKind(a.entry), a.entry)} · {formatRelativeTime(a.time.updated)}
                        </div>
                      </div>
                    </DropdownMenuRadioItem>
                  ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span className="truncate px-1.5 text-sm font-medium text-fg" title={p.info.title}>
            {p.info.title || "Untitled artifact"}
          </span>
        )}
        <span
          data-testid="artifact-kind"
          className="hidden shrink-0 rounded-sm bg-bg-muted px-1.5 py-px text-[11px] font-medium text-fg-secondary @[400px]:inline"
        >
          {kindLabel(p.kind, p.info.entry)}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        {shown !== undefined ? (
          <DropdownMenu>
            <Tip label="Version history" side="bottom">
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="px-2 text-xs text-fg-secondary"
                  data-testid="artifact-version"
                >
                  <History className="@[680px]:hidden" />
                  <span className="hidden @[680px]:inline">
                    v{shown}
                    {shownTime ? ` · ${formatRelativeTime(shownTime)}` : ""}
                  </span>
                  <ChevronDown className="size-3.5 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
            </Tip>
            <DropdownMenuContent align="end" className="max-h-80 w-64 overflow-y-auto">
              <DropdownMenuLabel>Versions</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={String(shown)}
                onValueChange={(v) => p.onVersion(Number(v) === latest ? undefined : Number(v))}
              >
                {[...p.versions]
                  .sort((a, b) => b.n - a.n)
                  .map((v) => (
                    <DropdownMenuRadioItem key={v.n} value={String(v.n)} className="h-auto py-1.5">
                      <div className="min-w-0">
                        <div>
                          Version {v.n}
                          {v.n === latest ? <span className="ml-1.5 text-fg-muted">Latest</span> : null}
                        </div>
                        <div className="truncate text-[11.5px] text-fg-muted">
                          {formatRelativeTime(v.time)}
                          {v.title ? ` · ${v.title}` : ""}
                        </div>
                      </div>
                    </DropdownMenuRadioItem>
                  ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}

        <IconButton label="Refresh" onClick={p.onRefresh} disabled={p.mode !== "preview"}>
          <RotateCw />
        </IconButton>

        <div className="hidden @[480px]:contents">
          <DropdownMenu>
            <Tip label="Preview size" side="bottom">
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Preview size"
                  disabled={p.mode !== "preview"}
                >
                  <SizeIcon />
                </Button>
              </DropdownMenuTrigger>
            </Tip>
            <DropdownMenuContent align="end" className="min-w-[160px]">
              <DropdownMenuRadioGroup value={p.size} onValueChange={(v) => p.onSize(v as PreviewSizeID)}>
                {PREVIEW_SIZES.map((s) => {
                  const Icon = SIZE_ICON[s.id]
                  return (
                    <DropdownMenuRadioItem key={s.id} value={s.id}>
                      <Icon />
                      {s.label}
                      {s.width ? (
                        <span className="ml-auto pr-1 text-xs text-fg-muted">{s.width}px</span>
                      ) : null}
                    </DropdownMenuRadioItem>
                  )
                })}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="ml-0.5 flex items-center rounded-md border border-border">
          <Tip label="Copy source" side="bottom">
            <Button
              size="sm"
              variant="ghost"
              className="rounded-r-none px-2 text-xs"
              onClick={p.onCopy}
              aria-label="Copy source"
              data-testid="artifact-copy"
            >
              {p.copied ? <Check className="text-success" /> : <Copy />}
              <span className="hidden @[720px]:inline">{p.copied ? "Copied" : "Copy"}</span>
            </Button>
          </Tip>
          <span className="h-4 w-px bg-border" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" className="w-6 rounded-l-none" aria-label="Export">
                <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={p.onDownloadHTML}>
                <Download /> Download as HTML
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={p.onDownloadFiles}>
                {p.fileCount > 1 ? <FileArchive /> : <FileCode />}
                {p.fileCount > 1 ? "Download files (.zip)" : `Download ${p.info.entry.split("/").pop()}`}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={p.onOpenInBrowser}>
                <ExternalLink /> Open in browser
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <IconButton
          label={p.fullscreen ? "Exit full screen" : "Full screen"}
          shortcut={p.fullscreen ? "Esc" : undefined}
          onClick={p.onFullscreen}
        >
          {p.fullscreen ? <Minimize2 /> : <Maximize2 />}
        </IconButton>
        <IconButton label="Close" onClick={p.onClose} data-testid="artifact-close">
          <X />
        </IconButton>
      </div>
    </div>
  )
}
