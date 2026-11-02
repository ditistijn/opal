import { useEffect } from "react"
import { useShallow } from "zustand/react/shallow"
import { Tip } from "@/components/ui/tooltip"
import { useSurface } from "@/hooks/use-surface"
import { runtime } from "@/lib/runtime"
import { cn } from "@/lib/utils"
import { sessionStatus, summarize, useCodeStatus } from "./code-status"

/**
 * Subtle title-bar indicator: a pulsing dot while any Code session is running (amber when one is
 * waiting for a permission). Renders nothing outside the Code surface or when everything is idle.
 */
export function CodeStatusDot({ className }: { className?: string }) {
  const { surface } = useSurface()
  const { busy, permission } = useCodeStatus(useShallow((s) => summarize(s.bySession)))
  if (surface !== "code" || (!busy && !permission)) return null
  const label = permission
    ? `${permission} session${permission === 1 ? "" : "s"} waiting for permission`
    : `${busy} session${busy === 1 ? "" : "s"} running`
  return (
    <Tip label={label} side="bottom">
      <span
        role="status"
        aria-label={label}
        className={cn("inline-flex size-4 items-center justify-center", className)}
      >
        <span
          className={cn("size-1.5 rounded-full", permission ? "bg-warning" : "animate-pulse bg-accent")}
        />
      </span>
    </Tip>
  )
}

function Reporter({ sessionID }: { sessionID: string }) {
  const activity = runtime.useSessionActivity(sessionID)
  // Only sessions that are executing can be waiting on a permission; avoid loading lists for idle ones.
  const permissions = runtime.usePermissions(activity !== "idle" ? sessionID : undefined)
  const status = sessionStatus(activity, permissions.length)
  useEffect(() => {
    useCodeStatus.getState().report(sessionID, status)
  }, [sessionID, status])
  useEffect(() => () => useCodeStatus.getState().clear(sessionID), [sessionID])
  return null
}

/** Mounted once by the Code surface: reports every code session's status into useCodeStatus. */
export function CodeStatusReporter({ sessionIDs }: { sessionIDs: string[] }) {
  return (
    <>
      {sessionIDs.map((id) => (
        <Reporter key={id} sessionID={id} />
      ))}
    </>
  )
}

/** Status of one session for rows/headers (reads the aggregate store). */
export function useSessionCodeStatus(sessionID: string | undefined) {
  return useCodeStatus((s) => (sessionID ? (s.bySession[sessionID] ?? "idle") : "idle"))
}
