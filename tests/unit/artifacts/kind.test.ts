import { describe, expect, it } from "vitest"
import { detectKind, kindLabel, shellFor, shikiLanguage, followsTheme } from "@/lib/artifacts"

describe("detectKind", () => {
  it.each([
    ["index.html", "html"],
    ["site/page.HTM", "html"],
    ["App.tsx", "react"],
    ["src/App.jsx", "react"],
    ["index.md", "markdown"],
    ["notes.markdown", "markdown"],
    ["flow.mmd", "mermaid"],
    ["flow.mermaid", "mermaid"],
    ["logo.svg", "svg"],
    ["data.json", "json"],
    ["sales.csv", "csv"],
    ["sales.tsv", "csv"],
    ["main.py", "code"],
    ["styles.css", "code"],
    ["photo.png", "unknown"],
    ["doc.pdf", "unknown"],
  ] as const)("%s → %s", (entry, kind) => {
    expect(detectKind(entry)).toBe(kind)
  })

  it("classifies .js/.ts entries by content", () => {
    expect(detectKind("App.js", { "App.js": 'import React from "react"\nexport default () => null' })).toBe(
      "react",
    )
    expect(detectKind("App.js", { "App.js": "export default function A() { return <div/> }" })).toBe("react")
    expect(detectKind("main.ts", { "main.ts": "const x: number = 1 < 2 ? 1 : 2\nconsole.log(x)" })).toBe(
      "code",
    )
    expect(detectKind("main.js")).toBe("code")
  })

  it("treats extensionless text files as code", () => {
    expect(detectKind("Makefile", { Makefile: "all:\n\techo hi" })).toBe("code")
    expect(detectKind("Makefile")).toBe("unknown")
  })
})

describe("labels and shells", () => {
  it("labels kinds like the badge shows them", () => {
    expect(kindLabel("html")).toBe("HTML")
    expect(kindLabel("react")).toBe("React")
    expect(kindLabel("markdown")).toBe("Markdown")
    expect(kindLabel("mermaid")).toBe("Mermaid")
    expect(kindLabel("csv", "a.tsv")).toBe("TSV")
    expect(kindLabel("code", "main.py")).toBe("Python")
    expect(kindLabel("code", "x.weird")).toBe("Code")
    expect(kindLabel("unknown")).toBe("File")
  })
  it("maps kinds to runtime shells", () => {
    expect(shellFor("html")).toBeUndefined()
    expect(shellFor("unknown")).toBeUndefined()
    expect(shellFor("react")).toBe("react.html")
    expect(shellFor("markdown")).toBe("markdown.html")
    expect(shellFor("code")).toBe("code.html")
  })
  it("knows Shiki languages and theming", () => {
    expect(shikiLanguage("App.tsx")).toBe("tsx")
    expect(shikiLanguage("a/b/run.sh")).toBe("bash")
    expect(shikiLanguage("README")).toBe("text")
    expect(followsTheme("markdown")).toBe(true)
    expect(followsTheme("html")).toBe(false)
    expect(followsTheme("react")).toBe(false)
  })
})
