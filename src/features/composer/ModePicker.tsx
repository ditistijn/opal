import { Check, ChevronDown } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { ModeID } from "@/lib/runtime"
import { MODES, modeInfo } from "./modes"

export function ModePicker({ value, onChange }: { value: ModeID | undefined; onChange(mode: ModeID): void }) {
  const current = modeInfo(value)
  const Icon = current.icon
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Mode: ${current.label}`}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[13px] text-fg-secondary transition-fast hover:bg-bg-muted hover:text-fg data-[state=open]:bg-bg-muted"
        >
          <Icon className="size-4" />
          <span>{current.label}</span>
          <ChevronDown className="size-3.5 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Mode</DropdownMenuLabel>
        {MODES.map((m) => {
          const MIcon = m.icon
          return (
            <DropdownMenuItem key={m.id} onSelect={() => onChange(m.id)} className="h-auto items-start py-2">
              <MIcon className="mt-0.5" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[13px] text-fg">{m.label}</span>
                <span className="text-xs text-fg-muted">{m.description}</span>
              </span>
              {m.id === current.id ? <Check className="mt-0.5 !text-accent" /> : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
