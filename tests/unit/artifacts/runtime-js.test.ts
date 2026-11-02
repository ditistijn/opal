/**
 * The iframe-side runtime (public/artifact-runtime/runtime.js) — path resolution used for relative
 * imports and assets must never escape the artifact, and embedded mode must serve files from the payload.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { beforeAll, describe, expect, it } from "vitest"

interface RT {
  mode: string
  normalize(p: string): string | null
  resolve(from: string, spec: string): string | null
  readFile(p: string): Promise<string>
  hasFile(p: string): Promise<boolean>
  readRuntimeFile(p: string): Promise<string>
  listFiles(): Promise<string[] | null>
  entry: string
}

let RT: RT
beforeAll(() => {
  const src = readFileSync(resolve(__dirname, "../../../public/artifact-runtime/runtime.js"), "utf8")
  const w = window as unknown as { __OPAL_ARTIFACT__: unknown; OpalRuntime: RT }
  w.__OPAL_ARTIFACT__ = {
    id: "art_x",
    entry: "src/App.tsx",
    files: { "src/App.tsx": "app", "src/lib/util.ts": "util", "data.json": "{}" },
    runtimeFiles: { "shadcn/button.jsx": "btn" },
  }
  new Function(src)()
  RT = w.OpalRuntime
})

describe("runtime.js", () => {
  it("runs in embedded mode from window.__OPAL_ARTIFACT__", () => {
    expect(RT.mode).toBe("embedded")
    expect(RT.entry).toBe("src/App.tsx")
  })

  it("normalizes and resolves paths inside the artifact", () => {
    expect(RT.normalize("./a/./b//c")).toBe("a/b/c")
    expect(RT.normalize("a/b/../c")).toBe("a/c")
    expect(RT.normalize("../x")).toBeNull()
    expect(RT.resolve("src/App.tsx", "./lib/util")).toBe("src/lib/util")
    expect(RT.resolve("src/App.tsx", "../data.json")).toBe("data.json")
    expect(RT.resolve("src/App.tsx", "/data.json")).toBe("data.json")
    expect(RT.resolve("src/App.tsx", "../../etc/passwd")).toBeNull()
  })

  it("reads files from the payload", async () => {
    await expect(RT.readFile("src/lib/util.ts")).resolves.toBe("util")
    await expect(RT.readFile("./src/../data.json")).resolves.toBe("{}")
    await expect(RT.readFile("missing.ts")).rejects.toThrow(/not found/)
    await expect(RT.readFile("../../x")).rejects.toThrow(/escapes/)
    await expect(RT.hasFile("src/App.tsx")).resolves.toBe(true)
    await expect(RT.hasFile("src/App")).resolves.toBe(false)
    await expect(RT.readRuntimeFile("shadcn/button.jsx")).resolves.toBe("btn")
    await expect(RT.listFiles()).resolves.toEqual(["src/App.tsx", "src/lib/util.ts", "data.json"])
  })
})
