import { FolderPlus, ShieldAlert, ShieldCheck, X } from "lucide-react"
import { useState } from "react"
import { runtime, sandboxRuntime } from "@/lib/runtime"
import type { SandboxMode } from "@/lib/runtime/contracts"
import { cn, isTauri } from "@/lib/utils"
import { Button, PageHeader, SectionTitle } from "../controls"
import { errorMessage } from "../providers/shared"

export const SANDBOX_OPTIONS: { value: SandboxMode; label: string; description: string }[] = [
  {
    value: "filesystem",
    label: "Protect my files (recommended)",
    description:
      "Commands can only write inside the conversation’s folder (or the repository in Code) and temp/cache folders. Everything else on your Mac stays untouched.",
  },
  {
    value: "strict",
    label: "Strict",
    description:
      "Like “Protect my files”, and also blocks internet access from commands (localhost still works).",
  },
  {
    value: "off",
    label: "Off",
    description: "Commands run with your full user permissions, like in Terminal.",
  },
]

export function SecurityPage() {
  const settings = runtime.useSettings()
  const { status } = sandboxRuntime.useStatus()
  const [error, setError] = useState<string>()
  const sandbox = settings.sandbox
  const desktop = isTauri()

  const update = async (patch: Partial<typeof sandbox>) => {
    setError(undefined)
    try {
      await runtime.updateSettings({ sandbox: { ...sandbox, ...patch } })
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const addFolder = async () => {
    const dir = await runtime.pickDirectory()
    if (!dir || sandbox.allowPaths.includes(dir)) return
    await update({ allowPaths: [...sandbox.allowPaths, dir] })
  }

  const available = status?.available === true
  return (
    <div>
      <PageHeader
        title="Security"
        description="Limit what the agent’s shell commands can do on your Mac. Changes apply to the next command."
      />

      <SectionTitle>Sandbox</SectionTitle>
      <div
        className={cn(
          "mb-3 flex items-start gap-2 rounded-md border border-border px-3 py-2 text-[12.5px] leading-relaxed",
          available && sandbox.mode !== "off" ? "text-fg-secondary" : "text-fg-muted",
        )}
        role="status"
      >
        {available && sandbox.mode !== "off" ? (
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
        ) : (
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-fg-muted" />
        )}
        <span>
          {!desktop
            ? "The sandbox is managed by the Opal desktop app."
            : !status
              ? "Checking the sandbox…"
              : !available
                ? "macOS sandbox-exec is not available on this system, so commands run unrestricted."
                : sandbox.mode === "off"
                  ? "Sandbox is off. Commands run with your full permissions."
                  : "Sandbox active: commands run through macOS sandbox-exec."}
        </span>
      </div>

      <div role="radiogroup" aria-label="Sandbox mode" className="flex flex-col gap-1">
        {SANDBOX_OPTIONS.map((option) => {
          const selected = sandbox.mode === option.value
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => void update({ mode: option.value })}
              className={cn(
                "flex w-full items-start gap-3 rounded-md border px-3 py-2.5 text-left transition-fast",
                selected ? "border-accent bg-bg-elevated" : "border-border hover:bg-bg-muted",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "mt-[3px] flex size-3.5 shrink-0 items-center justify-center rounded-full border",
                  selected ? "border-accent" : "border-border-strong",
                )}
              >
                {selected && <span className="size-1.5 rounded-full bg-accent" />}
              </span>
              <span className="min-w-0">
                <span className="block text-[13.5px] text-fg">{option.label}</span>
                <span className="mt-0.5 block text-[12.5px] leading-relaxed text-fg-muted">
                  {option.description}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      <SectionTitle>Extra writable folders</SectionTitle>
      <p className="mb-2 text-[12.5px] leading-relaxed text-fg-muted">
        Folders commands may also write to, for example a shared output folder or a tool’s config directory.
      </p>
      {sandbox.allowPaths.length > 0 && (
        <ul className="mb-2 flex flex-col rounded-md border border-border">
          {sandbox.allowPaths.map((path) => (
            <li
              key={path}
              className="flex items-center gap-2 border-b border-border px-3 py-1.5 last:border-b-0"
            >
              <span
                className="selectable min-w-0 flex-1 truncate font-mono text-[12px] text-fg-secondary"
                title={path}
              >
                {path}
              </span>
              <button
                type="button"
                aria-label={`Remove ${path}`}
                onClick={() => void update({ allowPaths: sandbox.allowPaths.filter((p) => p !== path) })}
                className="flex size-6 items-center justify-center rounded-md text-fg-muted hover:bg-bg-muted hover:text-fg"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Button
        size="sm"
        icon={<FolderPlus className="size-3.5" />}
        onClick={() => void addFolder()}
        disabled={sandbox.mode === "off"}
      >
        Add folder…
      </Button>

      <p className="mt-6 text-[12px] leading-relaxed text-fg-muted">
        The sandbox limits writes (and, in Strict mode, network) for commands the agent runs and for the Code
        terminal. It does not stop commands from reading files, and file edits made with the agent’s own edit
        tools still go through Opal’s permission prompts.
      </p>
      {error && <p className="mt-3 text-[12.5px] text-danger">{error}</p>}
    </div>
  )
}
