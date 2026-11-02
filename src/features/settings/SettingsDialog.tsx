/**
 * Settings — a centered dialog with a left navigation.
 */
import * as Dialog from "@radix-ui/react-dialog"
import {
  Boxes,
  Info,
  Palette,
  ScrollText,
  Shield,
  SlidersHorizontal,
  Smartphone,
  Wrench,
  X,
} from "lucide-react"
import { useEffect, useState, type ComponentType } from "react"
import { cn } from "@/lib/utils"
import { GeneralPage } from "./pages/GeneralPage"
import { AppearancePage } from "./pages/AppearancePage"
import { ProvidersPage } from "./pages/ProvidersPage"
import { PromptsPage } from "./pages/PromptsPage"
import { AdvancedPage } from "./pages/AdvancedPage"
import { AboutPage } from "./pages/AboutPage"
import { RemotePage } from "./pages/RemotePage"
import { SecurityPage } from "./pages/SecurityPage"

export type SettingsTab =
  "general" | "appearance" | "models" | "prompts" | "security" | "remote" | "advanced" | "about"

const TABS: { id: SettingsTab; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { id: "general", label: "General", icon: SlidersHorizontal },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "models", label: "Models & providers", icon: Boxes },
  { id: "prompts", label: "System prompts", icon: ScrollText },
  { id: "security", label: "Security", icon: Shield },
  { id: "remote", label: "Remote control", icon: Smartphone },
  { id: "advanced", label: "Advanced", icon: Wrench },
  { id: "about", label: "About", icon: Info },
]

const ALIASES: Record<string, SettingsTab> = {
  providers: "models",
  model: "models",
  prompt: "prompts",
  sandbox: "security",
  "remote-control": "remote",
}

export function resolveTab(tab: string | undefined): SettingsTab {
  if (!tab) return "general"
  if (TABS.some((item) => item.id === tab)) return tab as SettingsTab
  return ALIASES[tab] ?? "general"
}

export function SettingsDialog({
  open,
  onOpenChange,
  initialTab,
}: {
  open: boolean
  onOpenChange(open: boolean): void
  initialTab?: string
}) {
  const [tab, setTab] = useState<SettingsTab>(() => resolveTab(initialTab))

  useEffect(() => {
    if (open) setTab(resolveTab(initialTab))
  }, [open, initialTab])

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/25 data-[state=open]:animate-in data-[state=open]:fade-in-0 dark:bg-black/50" />
        <Dialog.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            // Keep focus in the dialog without painting a focus ring on the first nav item.
            event.preventDefault()
            ;(event.currentTarget as HTMLElement | null)?.focus()
          }}
          className={cn(
            "fixed top-1/2 left-1/2 z-50 flex h-[620px] max-h-[calc(100vh-48px)] w-[880px] max-w-[calc(100vw-48px)] -translate-x-1/2 -translate-y-1/2",
            "overflow-hidden rounded-xl border border-border bg-bg text-fg shadow-elevated focus:outline-none focus-visible:outline-none",
            // Phones (paired remote devices): full screen, navigation as a scrolling strip on top.
            "max-sm:h-[100dvh] max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:flex-col max-sm:rounded-none max-sm:border-0 max-sm:pt-[env(safe-area-inset-top)]",
          )}
        >
          <nav
            aria-label="Settings sections"
            className="flex w-[208px] shrink-0 flex-col border-r border-border bg-bg-sidebar px-2.5 pt-4 pb-3 max-sm:w-full max-sm:border-r-0 max-sm:border-b max-sm:pb-2 max-sm:[&_ul]:flex-row max-sm:[&_ul]:overflow-x-auto max-sm:[&_li]:shrink-0"
          >
            <Dialog.Title className="mb-3 px-2.5 font-serif text-[20px] text-fg">Settings</Dialog.Title>
            <ul className="flex flex-col gap-px">
              {TABS.map((item) => {
                const Icon = item.icon
                const selected = item.id === tab
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-current={selected ? "page" : undefined}
                      onClick={() => setTab(item.id)}
                      className={cn(
                        "flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13.5px] transition-fast",
                        selected
                          ? "bg-bg-inset text-fg"
                          : "text-fg-secondary hover:bg-bg-muted hover:text-fg",
                      )}
                    >
                      <Icon className={cn("size-4", selected ? "text-fg" : "text-fg-muted")} />
                      {item.label}
                    </button>
                  </li>
                )
              })}
            </ul>
          </nav>
          <div className="relative flex min-w-0 flex-1 flex-col">
            <Dialog.Close
              aria-label="Close settings"
              className="absolute top-3 right-3 z-10 flex size-7 items-center justify-center rounded-md text-fg-muted transition-fast hover:bg-bg-muted hover:text-fg"
            >
              <X className="size-4" />
            </Dialog.Close>
            <div className="min-h-0 flex-1 overflow-y-auto px-8 pt-6 pb-8 max-sm:px-4 max-sm:pb-[max(2rem,env(safe-area-inset-bottom))]">
              {tab === "general" && <GeneralPage />}
              {tab === "appearance" && <AppearancePage />}
              {tab === "models" && <ProvidersPage />}
              {tab === "prompts" && <PromptsPage />}
              {tab === "security" && <SecurityPage />}
              {tab === "remote" && <RemotePage />}
              {tab === "advanced" && <AdvancedPage />}
              {tab === "about" && <AboutPage />}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export default SettingsDialog
