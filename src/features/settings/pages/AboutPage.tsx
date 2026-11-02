import { useEffect, useState } from "react"
import { ExternalLink } from "lucide-react"
import { Progress } from "@/components/ui/progress"
import { runtime } from "@/lib/runtime"
import { formatRelativeTime, isTauri } from "@/lib/utils"
import { PACKAGE_VERSION, UPDATES_DESKTOP_ONLY, getAppVersion } from "@/lib/native/updates"
import { notesExcerpt, useUpdates, type UpdateState } from "@/lib/native/update-store"
import { openExternal } from "../providers/shared"
import { Button, PageHeader, SettingRow, Switch } from "../controls"

function Link({ href, children }: { href: string; children: string }) {
  return (
    <button
      type="button"
      onClick={() => void openExternal(href)}
      className="inline-flex items-center gap-1 text-[13px] text-fg-secondary hover:text-fg"
    >
      {children}
      <ExternalLink className="size-3" />
    </button>
  )
}

function useAppVersion() {
  const [version, setVersion] = useState(PACKAGE_VERSION)
  useEffect(() => {
    let alive = true
    void getAppVersion().then((v) => alive && setVersion(v))
    return () => {
      alive = false
    }
  }, [])
  return version
}

/** The description line(s) under "Check for updates" for the current update state. */
function UpdateStatusText({ state }: { state: UpdateState }) {
  const checked = state.lastChecked ? ` · Checked ${formatRelativeTime(state.lastChecked).toLowerCase()}` : ""
  switch (state.status) {
    case "checking":
      return <span>Checking…</span>
    case "none":
      return <span>You’re up to date{checked}</span>
    case "available": {
      const excerpt = notesExcerpt(state.available?.notes)
      return (
        <span className="flex flex-col gap-1">
          <span className="text-fg-secondary">Opal {state.available?.version} is available</span>
          {excerpt && <span className="selectable line-clamp-3 max-w-[420px]">{excerpt}</span>}
        </span>
      )
    }
    case "downloading":
      return (
        <span className="flex w-[300px] max-w-full flex-col gap-1.5">
          <span>Downloading Opal {state.available?.version}…</span>
          <Progress value={state.progress} label="Download progress" />
        </span>
      )
    case "installing":
      return <span>Installing Opal {state.available?.version}… Opal will restart.</span>
    case "error":
      return <span className="selectable text-danger/80">{state.error}</span>
    default:
      return <span>Opal checks GitHub Releases for new versions.</span>
  }
}

function UpdateRow() {
  const state = useUpdates()
  const desktop = isTauri()
  const busy = state.status === "checking" || state.status === "downloading" || state.status === "installing"
  const canInstall = desktop && state.status === "available" && !!state.available
  return (
    <SettingRow
      label="Check for updates"
      description={desktop ? <UpdateStatusText state={state} /> : UPDATES_DESKTOP_ONLY}
    >
      {canInstall ? (
        <Button variant="primary" onClick={() => void state.install()}>
          Update and restart
        </Button>
      ) : (
        <Button disabled={!desktop || busy} onClick={() => void state.check({ silent: false })}>
          {state.status === "checking"
            ? "Checking…"
            : state.status === "downloading" || state.status === "installing"
              ? "Updating…"
              : "Check for updates"}
        </Button>
      )}
    </SettingRow>
  )
}

export function AboutPage() {
  const server = runtime.useServer()
  const settings = runtime.useSettings()
  const version = useAppVersion()
  return (
    <div>
      <PageHeader title="About" />
      <div className="mb-6 flex items-center gap-4">
        <div
          aria-hidden
          className="flex size-14 items-center justify-center rounded-2xl bg-accent-soft font-serif text-[26px] text-accent"
        >
          O
        </div>
        <div>
          <div className="font-serif text-[22px] text-fg">Opal</div>
          <div className="text-[13px] text-fg-muted">Version {version}</div>
        </div>
      </div>
      <p className="mb-4 max-w-[520px] text-[13px] leading-relaxed text-fg-secondary">
        A native macOS AI desktop app with chat, Projects, Artifacts and a coding surface — for any model
        provider you choose.
      </p>
      <div>
        <UpdateRow />
        <SettingRow
          label="Automatically check for updates"
          description="Look for a new version shortly after launch and every few hours. Nothing installs without your click."
          htmlFor="settings-auto-update"
        >
          <Switch
            id="settings-auto-update"
            checked={settings.updates.autoCheck}
            onCheckedChange={(autoCheck) => void runtime.updateSettings({ updates: { autoCheck } })}
          />
        </SettingRow>
        <SettingRow
          label="Engine"
          description="Agent loop, tools, sessions and providers are powered by OpenCode (MIT)."
        >
          <span className="text-[13px] text-fg-secondary">
            {server.state === "ready" && server.version ? `OpenCode ${server.version}` : "OpenCode"}
          </span>
        </SettingRow>
        <SettingRow label="OpenCode" description="The open source AI coding agent.">
          <Link href="https://github.com/anomalyco/opencode">GitHub</Link>
        </SettingRow>
        <SettingRow
          label="Licenses"
          description="Opal bundles open source software; see each project's license."
        >
          <Link href="https://github.com/anomalyco/opencode/blob/dev/LICENSE">OpenCode license</Link>
        </SettingRow>
      </div>
    </div>
  )
}
