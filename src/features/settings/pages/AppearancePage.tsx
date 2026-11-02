import { Check } from "lucide-react"
import { runtime } from "@/lib/runtime"
import type { ThemePreference } from "@/lib/runtime/contracts"
import { cn } from "@/lib/utils"
import { PageHeader, SectionTitle } from "../controls"

/**
 * Preview palettes mirror the light/dark tokens in src/index.css. They are needed here because a preview must show
 * the *other* theme regardless of which one is active (tokens are only defined on :root).
 */
const PREVIEW = {
  light: {
    bg: "#faf9f5",
    sidebar: "#f0eee6",
    elevated: "#ffffff",
    line: "rgba(20,20,19,0.12)",
    ink: "#141413",
    muted: "#b4b2a9",
    bubble: "#eeece2",
    accent: "#d97757",
  },
  dark: {
    bg: "#262624",
    sidebar: "#1f1e1d",
    elevated: "#30302e",
    line: "rgba(240,238,230,0.12)",
    ink: "#f0eee6",
    muted: "#5f5d57",
    bubble: "#3a3936",
    accent: "#d97757",
  },
} as const

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "Match system" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
]

function MiniWindow({ palette }: { palette: (typeof PREVIEW)["light"] | (typeof PREVIEW)["dark"] }) {
  return (
    <div className="flex h-full w-full" style={{ background: palette.bg }}>
      <div className="flex w-[30%] flex-col gap-1.5 p-2" style={{ background: palette.sidebar }}>
        <div className="h-1.5 w-3/4 rounded-full" style={{ background: palette.muted }} />
        <div className="h-1.5 w-1/2 rounded-full" style={{ background: palette.muted }} />
        <div className="h-1.5 w-2/3 rounded-full" style={{ background: palette.muted }} />
      </div>
      <div className="flex flex-1 flex-col justify-between p-2">
        <div className="flex flex-col gap-1.5">
          <div className="ml-auto h-2.5 w-1/2 rounded-md" style={{ background: palette.bubble }} />
          <div className="h-1.5 w-5/6 rounded-full" style={{ background: palette.muted }} />
          <div className="h-1.5 w-2/3 rounded-full" style={{ background: palette.muted }} />
        </div>
        <div
          className="flex h-4 items-center justify-end rounded-md px-1"
          style={{ background: palette.elevated, boxShadow: `0 0 0 1px ${palette.line}` }}
        >
          <div className="size-2 rounded-full" style={{ background: palette.accent }} />
        </div>
      </div>
    </div>
  )
}

export function AppearancePage() {
  const settings = runtime.useSettings()
  return (
    <div>
      <PageHeader title="Appearance" />
      <SectionTitle>Theme</SectionTitle>
      <div role="radiogroup" aria-label="Theme" className="mt-3 grid grid-cols-3 gap-4">
        {OPTIONS.map((option) => {
          const selected = settings.theme === option.value
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => void runtime.updateSettings({ theme: option.value })}
              className="group flex flex-col gap-2 text-left"
            >
              <div
                className={cn(
                  "relative aspect-[16/10] w-full overflow-hidden rounded-lg border transition-fast",
                  selected
                    ? "border-accent ring-2 ring-accent/30"
                    : "border-border-strong group-hover:border-fg-faint",
                )}
              >
                {option.value === "system" ? (
                  <div className="flex h-full w-full">
                    <div className="h-full w-1/2 overflow-hidden">
                      <div className="h-full w-[200%]">
                        <MiniWindow palette={PREVIEW.light} />
                      </div>
                    </div>
                    <div className="relative h-full w-1/2 overflow-hidden">
                      <div className="absolute inset-y-0 right-0 h-full w-[200%]">
                        <MiniWindow palette={PREVIEW.dark} />
                      </div>
                    </div>
                  </div>
                ) : (
                  <MiniWindow palette={PREVIEW[option.value]} />
                )}
                {selected && (
                  <span className="absolute right-1.5 bottom-1.5 flex size-4 items-center justify-center rounded-full bg-accent text-fg-on-accent">
                    <Check className="size-2.5" strokeWidth={3} />
                  </span>
                )}
              </div>
              <span className={cn("text-[13px]", selected ? "font-medium text-fg" : "text-fg-secondary")}>
                {option.label}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
