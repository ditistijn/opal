import { FileText, LayoutDashboard, Telescope, Workflow, type LucideIcon } from "lucide-react"
import { useState } from "react"
import { Composer } from "@/features/composer/Composer"
import { useDrafts } from "@/features/composer/drafts"
import type { ModelRef } from "@/lib/opencode/types"
import { runtime, type ModeID, type PromptInput } from "@/lib/runtime"
import { greetingFor } from "./greeting"
import { useNav } from "./nav-store"
import { OpalGlyph } from "./OpalGlyph"

const CHIPS: { label: string; icon: LucideIcon; prompt: string; mode?: ModeID }[] = [
  { label: "Make a dashboard", icon: LayoutDashboard, prompt: "Make a dashboard that ", mode: "artifact" },
  { label: "Draw a diagram", icon: Workflow, prompt: "Draw a diagram of ", mode: "artifact" },
  {
    label: "Summarize a document",
    icon: FileText,
    prompt: "Summarize this document in five bullet points: ",
    mode: "general",
  },
  { label: "Research a topic", icon: Telescope, prompt: "Research the latest on ", mode: "research" },
]

/** Starts a chat (optionally inside a project) and navigates to it. */
export async function startChat(
  input: PromptInput,
  opts: { mode?: ModeID; model?: ModelRef; projectID?: string },
) {
  const session = await runtime.createSession({ surface: "chat", ...opts })
  useNav.getState().go({ kind: "session", sessionID: session.id })
  await runtime.sendPrompt(session.id, input)
  return session
}

/** New-chat screen: serif greeting, centered composer, quick-start chips. */
export function HomeView() {
  const settings = runtime.useSettings()
  const [mode, setMode] = useState<ModeID>(settings.defaultMode)
  const [model, setModel] = useState<ModelRef | undefined>(settings.defaultModel)
  const setText = useDrafts((s) => s.setText)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col justify-center px-6 pb-[12vh] pt-10">
        <h1 className="mb-8 flex items-center justify-center gap-3 text-center font-serif text-[40px] font-normal leading-tight tracking-[-0.015em] text-fg">
          <OpalGlyph className="size-9" />
          {greetingFor()}
        </h1>
        <Composer
          draftKey="home"
          mode={mode}
          onModeChange={setMode}
          model={model}
          onModelChange={setModel}
          autoFocus
          onSubmit={(input) => startChat(input, { mode, model })}
        />
        <div className="mt-4 flex flex-wrap justify-center gap-2" aria-label="Suggestions">
          {CHIPS.map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={() => {
                setText("home", c.prompt)
                if (c.mode) setMode(c.mode)
                requestAnimationFrame(() => {
                  const ta = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')
                  ta?.focus()
                  ta?.setSelectionRange(ta.value.length, ta.value.length)
                })
              }}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-bg px-3 text-[13px] text-fg-secondary transition-fast hover:border-border-strong hover:bg-bg-muted hover:text-fg"
            >
              <c.icon className="size-4 text-fg-muted" />
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
