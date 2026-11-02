/**
 * Artifact path rules, mirrored from src-tauri/src/artifact_protocol.rs (normalize_segments) and the
 * OpenCode artifact provider (core/src/artifact.ts normalizePath). Used by the frontend before building
 * URLs or zip entries so both sides agree on what is a valid artifact file path.
 */
export const ARTIFACT_ID_RE = /^art_[A-Za-z0-9_-]+$/

export function isValidArtifactID(id: string): boolean {
  return ARTIFACT_ID_RE.test(id)
}

/**
 * Normalizes a relative artifact path: drops empty and "." segments, rejects "..", NUL, backslashes and
 * ":" (drive letters / schemes). Returns undefined for invalid paths. A leading "/" is treated as the
 * artifact root (never the filesystem root).
 */
export function normalizeArtifactPath(path: string): string | undefined {
  if (path.includes("\0")) return undefined
  const out: string[] = []
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") continue
    if (seg === ".." || seg.includes("\\") || seg.includes(":")) return undefined
    out.push(seg)
  }
  return out.join("/")
}

/** Percent-encodes each segment of a normalized path for use in a URL. */
export function encodeArtifactPath(path: string): string {
  return path
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/")
}
