/**
 * Client-side concurrency limiter for prompts ("Max concurrent API connections").
 *
 * A session holds a slot from the moment its prompt is started until it goes idle (or the prompt
 * fails / is interrupted). At most `max()` sessions hold slots; further prompts wait in FIFO order
 * and their sessions report activity "queued". Prompts for a session that already holds a slot
 * start immediately (the server queues/steers them inside that session).
 *
 * LIMITATION: only prompts sent by this Opal window are counted; subagent child sessions and work
 * started by other clients of the same server are not limited.
 */
export interface LimiterOptions {
  max: () => number
  onChange?: () => void
  log?: (line: string) => void
}

interface Waiting {
  sessionID: string
  start: () => void
}

export class Limiter {
  private readonly active = new Set<string>()
  private readonly queue: Waiting[] = []

  constructor(private readonly options: LimiterOptions) {}

  private get max() {
    const value = Math.floor(this.options.max())
    return Number.isFinite(value) && value > 0 ? value : 1
  }

  private log(line: string) {
    this.options.log?.(`${line} (${this.active.size}/${this.max} active, ${this.queue.length} queued)`)
  }

  isActive(sessionID: string) {
    return this.active.has(sessionID)
  }

  isQueued(sessionID: string) {
    return !this.active.has(sessionID) && this.queue.some((w) => w.sessionID === sessionID)
  }

  queuedSessions(): string[] {
    return [...new Set(this.queue.map((w) => w.sessionID))].filter((id) => !this.active.has(id))
  }

  /** Runs `start` now if a slot is free (or the session already has one), otherwise queues it. */
  acquire(sessionID: string, start: () => void) {
    if (this.active.has(sessionID) || this.active.size < this.max) {
      this.active.add(sessionID)
      this.log(`start ${sessionID}`)
      start()
    } else {
      this.queue.push({ sessionID, start })
      this.log(`queued ${sessionID}`)
    }
    this.options.onChange?.()
  }

  /** Frees the session's slot and starts waiting prompts. */
  release(sessionID: string) {
    if (!this.active.delete(sessionID)) return
    this.log(`release ${sessionID}`)
    this.pump()
    this.options.onChange?.()
  }

  /** Drops queued (not yet started) prompts for a session; returns how many were dropped. */
  cancel(sessionID: string): number {
    let dropped = 0
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i]!.sessionID === sessionID) {
        this.queue.splice(i, 1)
        dropped++
      }
    }
    if (dropped) {
      this.log(`cancelled ${dropped} queued for ${sessionID}`)
      this.options.onChange?.()
    }
    return dropped
  }

  /** Re-evaluates the queue (e.g. after the max setting increased). */
  pump() {
    while (this.queue.length && this.active.size < this.max) {
      const next = this.queue.shift()!
      this.active.add(next.sessionID)
      this.log(`start ${next.sessionID}`)
      next.start()
      // Later prompts for the same session no longer need to wait.
      for (let i = 0; i < this.queue.length;) {
        if (this.queue[i]!.sessionID === next.sessionID) this.queue.splice(i, 1)[0]!.start()
        else i++
      }
    }
  }
}
