import { ShieldAlert } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { useHotkeys } from "@/hooks/use-hotkeys"
import type { PermissionRequest } from "@/lib/opencode/types"
import { runtime } from "@/lib/runtime"
import { isMac } from "@/lib/utils"

const ACTION_LABEL: Record<string, string> = {
  edit: "Edit files",
  write: "Write files",
  read: "Read files",
  bash: "Run a command",
  shell: "Run a command",
  webfetch: "Fetch a web page",
  external_directory: "Access a folder outside this chat",
}

const COMMAND_ACTIONS = new Set(["bash", "shell"])

/**
 * Inline permission prompt rendered above the composer.
 * `variant="code"` (Code surface) shows the command/resources as a prominent monospace block and, with
 * `shortcuts`, binds ⌘⏎ = Allow once and Esc = Deny.
 */
export function PermissionCard({
  request,
  variant = "chat",
  shortcuts = false,
}: {
  request: PermissionRequest
  variant?: "chat" | "code"
  shortcuts?: boolean
}) {
  const [pending, setPending] = useState(false)
  const reply = async (decision: "once" | "always" | "reject") => {
    if (pending) return
    setPending(true)
    try {
      await runtime.replyPermission(request.sessionID, request.id, decision)
    } finally {
      setPending(false)
    }
  }
  useHotkeys([
    { combo: "mod+enter", enabled: shortcuts, allowInInput: true, handler: () => void reply("once") },
    { combo: "escape", enabled: shortcuts, allowInInput: true, handler: () => void reply("reject") },
  ])
  const action = ACTION_LABEL[request.action] ?? request.action
  const code = variant === "code"
  const command = COMMAND_ACTIONS.has(request.action)
  return (
    <div
      role="alertdialog"
      aria-label="Permission request"
      data-variant={variant}
      className="opal-fade-in mb-3 rounded-xl border border-border bg-bg-elevated p-4 shadow-elevated"
    >
      <div className="flex gap-3">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
          <ShieldAlert className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium text-fg">
            {code
              ? `Allow Opal to ${action.toLowerCase()}?`
              : (request.message ?? `Allow Opal to ${action.toLowerCase()}?`)}
          </div>
          <div className="mt-0.5 text-[12.5px] text-fg-secondary">
            Action: <span className="text-fg">{action}</span>
          </div>
          {code && request.resources.length ? (
            <pre
              aria-label="Resources"
              className="selectable mt-2.5 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-bg-muted px-3 py-2 font-mono text-[12.5px] leading-5 text-fg"
            >
              {request.resources.map((r) => (command ? `$ ${r}` : r)).join("\n")}
            </pre>
          ) : request.resources.length ? (
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Resources">
              {request.resources.map((r) => (
                <li
                  key={r}
                  className="selectable max-w-full truncate rounded-md bg-bg-muted px-2 py-0.5 font-mono text-[12px] text-fg-secondary"
                >
                  {r}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
      <div className="mt-3.5 flex justify-end gap-2">
        <Button variant="outline" size="sm" disabled={pending} onClick={() => reply("reject")}>
          Deny
          {shortcuts ? <Kbd className="-mr-1 text-fg-faint">Esc</Kbd> : null}
        </Button>
        <Button variant="outline" size="sm" disabled={pending} onClick={() => reply("always")}>
          Always allow
        </Button>
        <Button variant="primary" size="sm" disabled={pending} onClick={() => reply("once")}>
          Allow once
          {shortcuts ? <Kbd className="-mr-1 text-bg/60">{isMac ? "⌘⏎" : "Ctrl⏎"}</Kbd> : null}
        </Button>
      </div>
    </div>
  )
}
