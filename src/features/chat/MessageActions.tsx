import { Check, Copy, Pencil, RotateCcw } from "lucide-react"
import type { ReactNode } from "react"
import { Tip } from "@/components/ui/tooltip"
import { useCopy } from "@/hooks/use-copy"

export function ActionButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick(): void
  children: ReactNode
}) {
  return (
    <Tip label={label}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className="flex size-7 items-center justify-center rounded-md text-fg-muted transition-fast hover:bg-bg-muted hover:text-fg [&_svg]:size-[15px]"
      >
        {children}
      </button>
    </Tip>
  )
}

export function CopyAction({ text, label = "Copy" }: { text: string; label?: string }) {
  const { copied, copy } = useCopy()
  return (
    <ActionButton label={copied ? "Copied" : label} onClick={() => copy(text)}>
      {copied ? <Check /> : <Copy />}
    </ActionButton>
  )
}

export function EditAction({ onClick }: { onClick(): void }) {
  return (
    <ActionButton label="Edit" onClick={onClick}>
      <Pencil />
    </ActionButton>
  )
}

export function RetryAction({ onClick }: { onClick(): void }) {
  return (
    <ActionButton label="Retry" onClick={onClick}>
      <RotateCcw />
    </ActionButton>
  )
}
