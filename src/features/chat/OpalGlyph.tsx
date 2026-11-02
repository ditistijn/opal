import { cn } from "@/lib/utils"

/** Opal's mark: a small faceted gem. `animated` pulses it while a reply is being generated. */
export function OpalGlyph({ className, animated }: { className?: string; animated?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={cn("shrink-0 text-accent", animated && "opal-glyph-pulse", className)}
    >
      <path d="M7.2 3.5h9.6L21.5 9 12 20.5 2.5 9z" fill="currentColor" />
      <path
        d="M2.5 9h19M7.2 3.5 9.6 9 12 20.5M16.8 3.5 14.4 9 12 20.5M9.6 9 12 3.5 14.4 9"
        fill="none"
        stroke="var(--bg)"
        strokeOpacity="0.55"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  )
}
