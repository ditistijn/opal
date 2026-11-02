/**
 * Provider / model identifier rules.
 *
 * OpenCode (v2.2.5) constraints, verified in packages/schema/src/config/model.ts:
 *  - provider IDs in a model selection must match /^[^/#]+$/  (no "/" or "#")
 *  - model IDs must match /^[^#]+$/ (may contain "/", e.g. OpenRouter's "anthropic/claude-sonnet-4")
 * The provider ID is also the credential `integrationID`, a config key and a URL path segment, so Opal is stricter:
 * lowercase ASCII letters, digits, "-", "_" and "." only, starting with a letter or digit, ≤ 48 chars.
 */

export const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,47}$/

/** Lowercase slug for a provider ID (from a display name or a user-typed id). Never empty. */
export function sanitizeProviderID(input: string): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, 48)
    .replace(/[^a-z0-9]+$/, "")
  return slug || "provider"
}

export function isValidProviderID(id: string): boolean {
  return PROVIDER_ID_PATTERN.test(id)
}

/** A sanitized ID that does not collide with `taken` (appends -2, -3, …). */
export function uniqueProviderID(input: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  const base = sanitizeProviderID(input)
  if (!used.has(base)) return base
  for (let n = 2; ; n++) {
    const suffix = `-${n}`
    const candidate = `${base.slice(0, 48 - suffix.length).replace(/[^a-z0-9]+$/, "")}${suffix}`
    if (!used.has(candidate)) return candidate
  }
}

export function isValidModelID(id: string): boolean {
  return id.trim() === id && id.length > 0 && !id.includes("#")
}

/** "providerID/modelID" (OpenCode's short model selection form). */
export function formatModelRef(ref: { providerID: string; id: string; variant?: string }): string {
  return `${ref.providerID}/${ref.id}${ref.variant ? `#${ref.variant}` : ""}`
}

/** Parses "providerID/modelID[#variant]"; returns undefined when invalid. */
export function parseModelRef(
  input: string,
): { providerID: string; id: string; variant?: string } | undefined {
  const slash = input.indexOf("/")
  if (slash <= 0) return undefined
  const providerID = input.slice(0, slash)
  const hash = input.indexOf("#", slash + 1)
  const id = input.slice(slash + 1, hash === -1 ? undefined : hash)
  const variant = hash === -1 ? undefined : input.slice(hash + 1)
  if (!id || providerID.includes("#") || (variant !== undefined && (!variant || variant.includes("#"))))
    return undefined
  return variant ? { providerID, id, variant } : { providerID, id }
}
