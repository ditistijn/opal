/** Thin determinate progress bar (0–1), token-driven. */
export function Progress({ value, label }: { value: number; label: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100)
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className="h-1 w-full overflow-hidden rounded-full bg-bg-inset"
    >
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-150"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
