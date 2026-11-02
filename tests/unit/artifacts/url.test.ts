import { describe, expect, it } from "vitest"
import { isOpenableURL, previewURL, sandboxFor } from "@/lib/artifacts"

const info = { id: "art_01ABC", entry: "index.html" }

describe("previewURL", () => {
  it("loads html directly from the artifact protocol", () => {
    expect(previewURL(info, "html", { transport: "protocol" })).toBe(
      "artifact://localhost/art_01ABC/index.html",
    )
    expect(previewURL(info, "html", { transport: "protocol", nonce: 42 })).toBe(
      "artifact://localhost/art_01ABC/index.html?v=42",
    )
  })

  it("encodes entry path segments", () => {
    expect(previewURL({ id: "art_x", entry: "./site/my page.html" }, "html", { transport: "protocol" })).toBe(
      "artifact://localhost/art_x/site/my%20page.html",
    )
  })

  it("uses runtime shells for other kinds", () => {
    const url = new URL(
      previewURL({ id: "art_x", entry: "src/App.tsx" }, "react", { transport: "protocol", theme: "dark" }),
    )
    expect(url.protocol).toBe("artifact:")
    expect(url.pathname).toBe("/_runtime/react.html")
    expect(url.searchParams.get("id")).toBe("art_x")
    expect(url.searchParams.get("entry")).toBe("src/App.tsx")
    expect(url.searchParams.get("theme")).toBe("dark")
    expect(url.searchParams.has("bridge")).toBe(false)
  })

  it("addresses version snapshots as <id>@<n>", () => {
    expect(previewURL(info, "html", { transport: "protocol", version: 3 })).toBe(
      "artifact://localhost/art_01ABC@3/index.html",
    )
    const url = new URL(
      previewURL({ id: "art_x", entry: "a.md" }, "markdown", { transport: "protocol", version: 2 }),
    )
    expect(url.searchParams.get("id")).toBe("art_x@2")
  })

  it("uses the app-served shells with the postMessage bridge in the browser", () => {
    expect(previewURL(info, "html", { transport: "bridge" })).toBe(
      "/artifact-runtime/html.html?bridge=1&id=art_01ABC&entry=index.html&theme=light",
    )
    expect(previewURL({ id: "art_x", entry: "a.png" }, "unknown", { transport: "bridge" })).toMatch(
      /^\/artifact-runtime\/code\.html\?bridge=1/,
    )
    expect(previewURL({ id: "art_x", entry: "a.md" }, "markdown", { transport: "bridge" })).toMatch(
      /^\/artifact-runtime\/markdown\.html\?bridge=1&id=art_x&entry=a\.md/,
    )
  })

  it("rejects invalid ids and unsafe entries", () => {
    expect(() => previewURL({ id: "../etc", entry: "a.html" }, "html", { transport: "protocol" })).toThrow()
    expect(() =>
      previewURL({ id: "art_x", entry: "../secret.html" }, "html", { transport: "protocol" }),
    ).toThrow()
    expect(() => previewURL({ id: "art_x", entry: "" }, "html", { transport: "protocol" })).toThrow()
  })
})

describe("sandbox + links", () => {
  it("only grants allow-same-origin on the isolated artifact:// origin", () => {
    expect(sandboxFor("protocol")).toContain("allow-same-origin")
    expect(sandboxFor("bridge")).not.toContain("allow-same-origin")
    for (const t of ["allow-scripts", "allow-forms", "allow-modals", "allow-popups", "allow-downloads"]) {
      expect(sandboxFor("protocol")).toContain(t)
    }
    expect(sandboxFor("protocol")).not.toContain("allow-top-navigation")
  })
  it("only opens http(s)/mailto links from artifacts", () => {
    expect(isOpenableURL("https://example.com")).toBe(true)
    expect(isOpenableURL("mailto:a@b.c")).toBe(true)
    expect(isOpenableURL("file:///etc/passwd")).toBe(false)
    expect(isOpenableURL("javascript:alert(1)")).toBe(false)
    expect(isOpenableURL("artifact://localhost/art_x/")).toBe(false)
    expect(isOpenableURL("not a url")).toBe(false)
  })
})
