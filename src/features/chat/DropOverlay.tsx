import { FilePlus2 } from "lucide-react"

/** Full-column overlay shown while files are dragged over the chat. */
export function DropOverlay({ label = "Drop files to add to the conversation" }: { label?: string }) {
  return (
    <div
      className="opal-fade-in pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent/60 bg-bg/85 backdrop-blur-[2px]"
      data-testid="drop-overlay"
    >
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="flex size-11 items-center justify-center rounded-full bg-accent-soft text-accent">
          <FilePlus2 className="size-5" />
        </span>
        <span className="text-[15px] font-medium text-fg">{label}</span>
        <span className="text-[12.5px] text-fg-muted">Images, PDFs, spreadsheets, code and more</span>
      </div>
    </div>
  )
}
