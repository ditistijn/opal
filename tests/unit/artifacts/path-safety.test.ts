/**
 * Path-safety expectations shared by the frontend (normalizeArtifactPath) and the Rust protocol
 * (src-tauri/src/artifact_protocol.rs `normalize_segments`, covered by its own #[cfg(test)] suite):
 *   - empty and "." segments are dropped; a leading "/" means the artifact root
 *   - ".." anywhere is rejected (never resolved), as are NUL, "\" and ":" inside a segment
 *   - artifact ids must match ^art_[A-Za-z0-9_-]+$ (snapshots: <id>@<n>)
 *   - Rust additionally canonicalizes the final path and refuses anything outside the artifact dir
 *     (symlink escapes), and serves index.html for directories.
 */
import { describe, expect, it } from "vitest"
import { encodeArtifactPath, isValidArtifactID, normalizeArtifactPath } from "@/lib/artifacts"

describe("normalizeArtifactPath", () => {
  it.each([
    ["index.html", "index.html"],
    ["./index.html", "index.html"],
    ["/index.html", "index.html"],
    ["a//b/./c.js", "a/b/c.js"],
    ["src/App.tsx", "src/App.tsx"],
    ["my file.html", "my file.html"],
  ])("%s → %s", (input, out) => {
    expect(normalizeArtifactPath(input)).toBe(out)
  })

  it.each(["../x", "a/../../x", "a/..", "a\\b", "C:/Windows", "a\0b", "x/..\\y"])("rejects %j", (input) => {
    expect(normalizeArtifactPath(input)).toBeUndefined()
  })

  it("encodes segments but keeps separators", () => {
    expect(encodeArtifactPath("a b/c#d?.html")).toBe("a%20b/c%23d%3F.html")
  })
})

describe("artifact ids", () => {
  it.each(["art_01JABCdef", "art_a-b_c"])("accepts %s", (id) => expect(isValidArtifactID(id)).toBe(true))
  it.each(["art_", "ART_x", "art_x.staging-1", "art_x/../y", "x", "art_x@1"])("rejects %s", (id) =>
    expect(isValidArtifactID(id)).toBe(false),
  )
})
