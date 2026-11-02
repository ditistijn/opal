/**
 * OpenCode-compatible identifiers, mirroring packages/schema/src/identifier.ts (v2.2.5):
 * 12 hex chars of (timestamp * 0x1000 + counter) — bit-inverted for descending ids — followed by
 * 14 random base62 chars. Session ids are "ses_" + descending(), so newer sessions sort first.
 *
 * Opal generates the session id before `session.create({ id })` so the conversation sandbox
 * folder can be named after it.
 */
const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
const RANDOM_LENGTH = 14
let lastTimestamp = 0
let counter = 0

export function identifier(descending: boolean, timestamp = Date.now()): string {
  if (timestamp !== lastTimestamp) {
    lastTimestamp = timestamp
    counter = 0
  }
  counter++
  const current = BigInt(timestamp) * 0x1000n + BigInt(counter)
  const value = descending ? ~current : current
  let time = ""
  for (let index = 0; index < 6; index++) {
    time += Number((value >> BigInt(40 - 8 * index)) & 0xffn)
      .toString(16)
      .padStart(2, "0")
  }
  const bytes = crypto.getRandomValues(new Uint8Array(RANDOM_LENGTH))
  return time + Array.from(bytes, (byte) => CHARS[byte % 62]).join("")
}

export function newSessionID(): string {
  return "ses_" + identifier(true)
}
