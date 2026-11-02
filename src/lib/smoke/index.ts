/**
 * In-app acceptance smoke harness. Inert unless the desktop app was started with OPAL_SMOKE
 * (inline JSON or a JSON file path; see scripts/smoke-mac.sh). Drives the real runtime through the primary
 * workflow and writes `<logs>/smoke-<name>.json` via `cmd_smoke_report`, then optionally exits the app.
 * Never throws: every outcome, including an invalid config, ends in a report.
 */
import { invoke } from "@tauri-apps/api/core"
import { parseSmokeConfig } from "./config"
import { createPhase, reopenPhase } from "./phases"
import { Recorder, type SmokeReport } from "./report"

export { parseSmokeConfig } from "./config"
export type { SmokeConfig } from "./config"
export type { SmokeReport, SmokeStep } from "./report"

let started = false

/** Called from main.tsx inside Tauri: runs the harness when OPAL_SMOKE is set. */
export async function startSmoke(): Promise<void> {
  if (started) return
  started = true
  let raw: unknown
  try {
    raw = await invoke("cmd_smoke_config")
  } catch (error) {
    const rec = new Recorder("smoke", "config")
    rec.fail("config", error)
    await writeReport(rec.report(), true)
    return
  }
  if (raw === null || raw === undefined) return
  await runSmoke(raw)
}

export async function runSmoke(raw: unknown): Promise<SmokeReport> {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const fallbackName =
    typeof value.name === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value.name) ? value.name : "smoke"
  let rec: Recorder
  let exit = value.exit === true
  try {
    const config = parseSmokeConfig(raw)
    exit = config.exit
    rec = new Recorder(config.name, config.phase)
    console.info(`[opal:smoke] phase ${config.phase} (${config.name})`)
    try {
      if (config.phase === "create") await createPhase(rec, config)
      else await reopenPhase(rec, config)
    } catch (error) {
      rec.fail("harness", error)
    }
  } catch (error) {
    rec = new Recorder(fallbackName, String(value.phase ?? "unknown"))
    rec.fail("config", error)
  }
  const report = rec.report()
  await writeReport(report, exit)
  return report
}

async function writeReport(report: SmokeReport, exit: boolean) {
  try {
    const file = await invoke<string>("cmd_smoke_report", { name: report.name, report, exit })
    console.info(`[opal:smoke] ${report.ok ? "PASS" : "FAIL"} → ${file}`)
  } catch (error) {
    console.error("[opal:smoke] could not write the report", String(error))
  }
}
