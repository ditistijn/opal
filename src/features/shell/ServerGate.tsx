import { useState, type ReactNode } from "react"
import { NO_SERVER_MESSAGE } from "@/lib/opencode/client"
import { decodeRemotePayload } from "@/lib/opencode/remote-pairing"
import { runtime } from "@/lib/runtime"
import { isTauri } from "@/lib/utils"

/**
 * Blocks the surfaces until the OpenCode sidecar is reachable, showing a quiet
 * A quiet loading state or a clear error with logs.
 */
export function ServerGate({ children }: { children: ReactNode }) {
  const status = runtime.useServer()
  if (status.state === "ready") return <>{children}</>
  if (status.state === "error" && !isTauri() && status.message === NO_SERVER_MESSAGE) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md space-y-2">
          <h1 className="font-serif text-2xl">Connect to Opal</h1>
          <p className="text-[14px] text-fg-secondary">
            On your Mac, open Opal → Settings → Remote control → Pair a device, then scan the QR code or paste
            the link.
          </p>
          <PasteLink />
        </div>
      </div>
    )
  }
  if (status.state === "error") {
    return (
      <div className="flex flex-1 items-center justify-center p-10">
        <div className="max-w-md space-y-3 text-center">
          <h1 className="font-serif text-2xl">Opal couldn't start its engine</h1>
          <p className="text-fg-secondary">{status.message}</p>
          {status.logs?.length ? (
            <pre className="selectable max-h-48 overflow-auto rounded-md bg-bg-muted p-3 text-left text-xs text-fg-secondary">
              {status.logs.join("\n")}
            </pre>
          ) : null}
          <button
            className="rounded-md bg-accent px-4 py-1.5 text-sm text-fg-on-accent hover:bg-accent-hover"
            onClick={() => runtime.restartServer()}
          >
            Try again
          </button>
          {!isTauri() && <PasteLink />}
        </div>
      </div>
    )
  }
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="flex items-center gap-2 text-sm text-fg-muted">
        <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
        {status.message ?? "Starting…"}
      </div>
    </div>
  )
}

/**
 * Browser build: pair by pasting a link. Needed for iOS home-screen apps, whose storage is separate from Safari's
 * (open the link in Safari, or copy it from Opal on the Mac and paste it here).
 */
function PasteLink() {
  const [value, setValue] = useState("")
  const [invalid, setInvalid] = useState(false)
  return (
    <form
      className="flex flex-col gap-2 pt-4 text-left"
      onSubmit={(event) => {
        event.preventDefault()
        const hash = value.slice(Math.max(0, value.indexOf("#")))
        if (!decodeRemotePayload(hash)) return setInvalid(true)
        window.location.hash = hash
        void runtime.restartServer()
      }}
    >
      <label htmlFor="opal-pairing-link" className="text-[13px] text-fg-secondary">
        Pair with Opal on your Mac: paste a pairing link (Settings → Remote control)
      </label>
      <input
        id="opal-pairing-link"
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          setInvalid(false)
        }}
        placeholder="http://…/#rc=…"
        className="selectable h-9 rounded-md border border-border-strong bg-bg-elevated px-2.5 font-mono text-[13px] text-fg"
      />
      {invalid && <p className="text-[12.5px] text-danger">That is not an Opal pairing link.</p>}
      <button
        type="submit"
        className="self-start rounded-md border border-border-strong px-3 py-1.5 text-sm hover:bg-bg-muted"
      >
        Connect
      </button>
    </form>
  )
}
