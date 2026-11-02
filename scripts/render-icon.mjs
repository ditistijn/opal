#!/usr/bin/env node
/**
 * Render an SVG to a square PNG with a transparent background using the Chromium that
 * Playwright already installs for e2e tests (no extra image dependencies).
 *
 *   node scripts/render-icon.mjs [in.svg] [out.png] [size]
 *   defaults: src-tauri/icons/opal.svg → src-tauri/icons/opal.png at 1024px
 *
 * Then regenerate every platform size with:  pnpm tauri icon src-tauri/icons/opal.png
 * (scripts/make-icons.sh does both.)
 */
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { chromium } from "@playwright/test"

const [inPath = "src-tauri/icons/opal.svg", outPath = "src-tauri/icons/opal.png", sizeArg = "1024"] =
  process.argv.slice(2)
const size = Number(sizeArg)
if (!Number.isInteger(size) || size <= 0) throw new Error(`invalid size: ${sizeArg}`)

const svg = await readFile(resolve(inPath), "utf8")
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
  const html = `<!doctype html><html><head><style>
    html,body{margin:0;padding:0;background:transparent}
    svg{display:block;width:${size}px;height:${size}px}
  </style></head><body>${svg}</body></html>`
  await page.setContent(html, { waitUntil: "load" })
  await page.screenshot({
    path: resolve(outPath),
    omitBackground: true,
    clip: { x: 0, y: 0, width: size, height: size },
  })
  console.log(`rendered ${inPath} → ${outPath} (${size}×${size})`)
} finally {
  await browser.close()
}
