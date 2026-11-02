import { FolderOpen, LoaderCircle, RefreshCw, RotateCcw } from "lucide-react"
import { useEffect, useState } from "react"
import { runtime } from "@/lib/runtime"
import type { AppSettings } from "@/lib/runtime/contracts"
import { isTauri } from "@/lib/utils"
import { Button, PageHeader, SectionTitle, SettingRow } from "../controls"
import { errorMessage } from "../providers/shared"

/** Preferences restored by "Reset preferences" (providers, projects and conversations are kept). */
export const DEFAULT_PREFERENCES: Pick<
  AppSettings,
  "theme" | "maxConcurrentConnections" | "defaultMode" | "promptOverrides" | "codeSurface"
> = {
  theme: "system",
  maxConcurrentConnections: 3,
  defaultMode: "artifact",
  promptOverrides: {},
  codeSurface: { useWorktrees: true, permissionMode: "ask" },
}

async function invoke<T>(command: string): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(command)
}

export function AdvancedPage() {
  const server = runtime.useServer()
  const [restarting, setRestarting] = useState(false)
  const [dataDir, setDataDir] = useState<string>()
  const [logs, setLogs] = useState<string[]>()
  const [logsOpen, setLogsOpen] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [error, setError] = useState<string>()
  const desktop = isTauri()

  useEffect(() => {
    if (!desktop) return
    invoke<{ root: string }>("cmd_paths")
      .then((paths) => setDataDir(paths.root))
      .catch(() => {})
  }, [desktop])

  const loadLogs = async () => {
    try {
      setLogs(await invoke<string[]>("cmd_server_logs"))
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const restart = async () => {
    setRestarting(true)
    setError(undefined)
    try {
      await runtime.restartServer()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setRestarting(false)
    }
  }

  const reset = async () => {
    if (!confirmReset) {
      setConfirmReset(true)
      return
    }
    setConfirmReset(false)
    try {
      await runtime.updateSettings(DEFAULT_PREFERENCES)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <div>
      <PageHeader title="Advanced" />

      <SectionTitle>OpenCode server</SectionTitle>
      <div>
        <SettingRow
          label="Status"
          description={
            server.state === "ready" ? (
              <span className="selectable font-mono text-[12px]">
                {server.url}
                {server.version ? ` · v${server.version}` : ""}
              </span>
            ) : server.state === "error" ? (
              <span className="selectable text-danger">{server.message}</span>
            ) : (
              (server.message ?? "Starting…")
            )
          }
        >
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-[12.5px] text-fg-secondary">
              <span
                className={
                  server.state === "ready"
                    ? "size-2 rounded-full bg-success"
                    : server.state === "error"
                      ? "size-2 rounded-full bg-danger"
                      : "size-2 rounded-full bg-warning"
                }
              />
              {server.state === "ready" ? "Running" : server.state === "error" ? "Error" : "Starting"}
            </span>
            <Button
              size="sm"
              icon={
                restarting ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )
              }
              onClick={restart}
              disabled={restarting}
            >
              Restart
            </Button>
          </div>
        </SettingRow>
        {desktop && (
          <SettingRow label="Server logs" description="Recent output from the bundled OpenCode server.">
            <Button
              size="sm"
              onClick={() => {
                setLogsOpen((open) => !open)
                if (!logsOpen) void loadLogs()
              }}
            >
              {logsOpen ? "Hide logs" : "Show logs"}
            </Button>
          </SettingRow>
        )}
        {logsOpen && (
          <pre className="selectable mb-3 max-h-[220px] overflow-auto rounded-lg border border-border bg-bg-muted p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-fg-secondary">
            {logs === undefined ? "Loading…" : logs.length ? logs.join("\n") : "No log output yet."}
          </pre>
        )}
        {server.state === "error" && server.logs?.length ? (
          <pre className="selectable mb-3 max-h-[220px] overflow-auto rounded-lg border border-border bg-bg-muted p-3 font-mono text-[11.5px] whitespace-pre-wrap text-fg-secondary">
            {server.logs.join("\n")}
          </pre>
        ) : null}
      </div>

      <SectionTitle>Data</SectionTitle>
      <div>
        {desktop && (
          <SettingRow
            label="Data folder"
            description={
              <span className="selectable font-mono text-[12px]">
                {dataDir ?? "~/Library/Application Support/Opal"}
              </span>
            }
          >
            <Button
              size="sm"
              icon={<FolderOpen className="size-3.5" />}
              disabled={!dataDir}
              onClick={() => dataDir && void runtime.revealPath(dataDir)}
            >
              Show in Finder
            </Button>
          </SettingRow>
        )}
        <SettingRow
          label="Reset preferences"
          description="Restore theme, defaults, concurrency, code permissions and system prompts. Providers, projects and conversations are kept."
        >
          <Button
            size="sm"
            variant={confirmReset ? "danger" : "danger-ghost"}
            icon={<RotateCcw className="size-3.5" />}
            onClick={reset}
            onBlur={() => setConfirmReset(false)}
          >
            {confirmReset ? "Confirm reset" : "Reset"}
          </Button>
        </SettingRow>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-[12.5px] text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
