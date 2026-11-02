/**
 * Small non-modal notice at the bottom of the window when a background check finds a new version.
 * "Later" hides it for this app session; nothing installs without the "Update and restart" click.
 */
import { Progress } from "@/components/ui/progress"
import { useUpdates, shouldShowBanner } from "@/lib/native/update-store"

export function UpdateBanner() {
  const state = useUpdates()
  if (!shouldShowBanner(state) || !state.available) return null
  const busy = state.status === "downloading" || state.status === "installing"
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 z-40 flex w-[min(92vw,460px)] -translate-x-1/2 flex-col gap-2 rounded-lg border border-border bg-bg-elevated px-3.5 py-2.5 text-fg shadow-elevated"
    >
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 truncate text-[13px]">
          {state.status === "installing"
            ? `Installing Opal ${state.available.version}…`
            : state.status === "downloading"
              ? `Downloading Opal ${state.available.version}…`
              : `Opal ${state.available.version} is available`}
        </span>
        {!busy && (
          <>
            <button
              type="button"
              onClick={() => state.dismiss()}
              className="h-7 shrink-0 rounded-md px-2.5 text-[12.5px] font-medium text-fg-secondary transition-fast hover:bg-bg-muted hover:text-fg"
            >
              Later
            </button>
            <button
              type="button"
              onClick={() => void state.install()}
              className="h-7 shrink-0 rounded-md bg-fg px-2.5 text-[12.5px] font-medium text-bg transition-fast hover:opacity-90"
            >
              Update and restart
            </button>
          </>
        )}
      </div>
      {state.status === "downloading" && <Progress value={state.progress} label="Download progress" />}
    </div>
  )
}
