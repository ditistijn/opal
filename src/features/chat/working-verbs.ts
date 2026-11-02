/**
 * Playful status verbs shown while the model is working ("Thinking…", "Pondering…").
 * Pure helpers + a small hook; the list is deliberately silly.
 */
import { useEffect, useState } from "react"

export const WORKING_VERBS = [
  "Thinking",
  "Opaling",
  "67ing",
  "Pondering",
  "Cogitating",
  "Noodling",
  "Marinating",
  "Percolating",
  "Brewing",
  "Mulling",
  "Ruminating",
  "Scheming",
  "Conjuring",
  "Tinkering",
  "Spelunking",
  "Manifesting",
  "Hatching",
  "Simmering",
  "Whirring",
  "Crunching",
  "Vibing",
  "Rummaging",
  "Herding electrons",
  "Consulting the opal",
  "Doing the thing",
  "Buffering wisdom",
  "Polishing pixels",
] as const

export type WorkingVerb = (typeof WORKING_VERBS)[number]

/** Picks a verb different from `previous` (deterministic with `random` for tests). */
export function pickVerb(previous?: string, random: () => number = Math.random): WorkingVerb {
  const pool = WORKING_VERBS.filter((v) => v !== previous)
  return pool[Math.floor(random() * pool.length)] ?? WORKING_VERBS[0]
}

export function verbLabel(verb: string) {
  return `${verb}…`
}

/** Rotates a verb every `intervalMs` while `active`; starts with "Thinking…" so the first frame is calm. */
export function useWorkingVerb(active: boolean, intervalMs = 2600): string {
  const [verb, setVerb] = useState<string>(WORKING_VERBS[0])
  useEffect(() => {
    if (!active) {
      setVerb(WORKING_VERBS[0])
      return
    }
    const id = window.setInterval(() => setVerb((v) => pickVerb(v)), intervalMs)
    return () => window.clearInterval(id)
  }, [active, intervalMs])
  return verbLabel(verb)
}
