#!/usr/bin/env node
// Bundles the artifact renderer runtime's offline dependencies into browser IIFE globals under
// public/artifact-runtime/vendor/. Output is committed; re-run after bumping the pinned versions.
//   window.sucrase   ← sucrase (TSX/JSX → JS transpiler for React artifacts)
//   window.marked    ← marked (Markdown artifacts)
//   window.hljs      ← highlight.js/lib/common (code blocks in Markdown + "code" artifacts)
// Owner: artifacts (see docs/ARTIFACTS.md).
import { build } from "esbuild"
import { fileURLToPath } from "node:url"
import path from "node:path"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const out = path.join(root, "public/artifact-runtime/vendor")

const entries = [
  { name: "sucrase", code: `import { transform } from "sucrase"; window.sucrase = { transform }` },
  {
    name: "marked",
    code: `import { marked, Marked } from "marked"; window.marked = marked; window.Marked = Marked`,
  },
  { name: "hljs", code: `import hljs from "highlight.js/lib/common"; window.hljs = hljs` },
]

for (const entry of entries) {
  await build({
    stdin: { contents: entry.code, resolveDir: root, loader: "js" },
    bundle: true,
    minify: true,
    format: "iife",
    target: "safari15",
    legalComments: "eof",
    define: { "process.env.NODE_ENV": '"production"' },
    outfile: path.join(out, `${entry.name}.js`),
  })
  console.log(`vendored ${entry.name}`)
}
