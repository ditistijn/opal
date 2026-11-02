/** Step recorder → the structured smoke report written by `cmd_smoke_report`. */
import { errorMessage } from "./wait"

export type Detail = Record<string, unknown>

export interface SmokeStep {
  id: string
  title: string
  ok: boolean
  ms: number
  detail?: Detail
  error?: string
}

export interface SmokeReport {
  name: string
  phase: string
  ok: boolean
  startedAt: string
  finishedAt: string
  steps: SmokeStep[]
  env: { version?: string; serverURL?: string; appVersion?: string }
  failedStep?: string
  sessionID?: string
  artifactID?: string
  directory?: string
  [key: string]: unknown
}

/** Runs steps in order; the first failing step stops the run. Never throws. */
export class Recorder {
  readonly steps: SmokeStep[] = []
  readonly startedAt = new Date().toISOString()
  readonly env: SmokeReport["env"] = {}
  readonly extra: Detail = {}
  failed: string | undefined

  constructor(
    readonly name: string,
    readonly phase: string,
    private readonly log: (line: string) => void = (line) => console.info(line),
  ) {}

  /** Runs `fn` as step `id`; returns false (and records the error) when it throws or a previous step failed. */
  async step(id: string, title: string, fn: (detail: Detail) => Promise<void>): Promise<boolean> {
    if (this.failed) return false
    const detail: Detail = {}
    const started = performance.now()
    this.log(`[opal:smoke] ▶ ${id} ${title}`)
    try {
      await fn(detail)
      const ms = Math.round(performance.now() - started)
      this.steps.push({ id, title, ok: true, ms, ...(Object.keys(detail).length ? { detail } : {}) })
      this.log(`[opal:smoke] ✓ ${id} (${ms}ms)`)
      return true
    } catch (error) {
      const ms = Math.round(performance.now() - started)
      const message = errorMessage(error)
      this.steps.push({
        id,
        title,
        ok: false,
        ms,
        ...(Object.keys(detail).length ? { detail } : {}),
        error: message,
      })
      this.failed = id
      this.log(`[opal:smoke] ✗ ${id} (${ms}ms): ${message}`)
      return false
    }
  }

  /** Records a failure that happened outside a step (e.g. an invalid config). */
  fail(id: string, error: unknown) {
    this.steps.push({ id, title: id, ok: false, ms: 0, error: errorMessage(error) })
    this.failed ??= id
  }

  report(): SmokeReport {
    const ok = !this.failed && this.steps.length > 0 && this.steps.every((s) => s.ok)
    return {
      name: this.name,
      phase: this.phase,
      ok,
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      steps: this.steps,
      env: this.env,
      ...(this.failed ? { failedStep: this.failed } : {}),
      ...this.extra,
    }
  }
}
