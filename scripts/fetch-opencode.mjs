#!/usr/bin/env node
/**
 * Download the pinned OpenCode CLI release and stage it as Opal's Tauri sidecar:
 *
 *   src-tauri/binaries/opencode-<rust-target-triple>      (tauri.conf.json → bundle.externalBin)
 *
 * Usage
 *   node scripts/fetch-opencode.mjs                      # host target, pinned version
 *   node scripts/fetch-opencode.mjs --target x86_64-apple-darwin
 *   node scripts/fetch-opencode.mjs --target all         # both macOS architectures
 *   node scripts/fetch-opencode.mjs --dry-run            # resolve + print the plan, download nothing big
 *   node scripts/fetch-opencode.mjs --force              # re-download even if already staged
 *   node scripts/fetch-opencode.mjs --out-dir /tmp/x     # stage somewhere else (testing)
 *   OPENCODE_VERSION=2.2.6 node scripts/fetch-opencode.mjs
 *
 * Integrity: the release's SHA256SUMS is fetched and the zip's SHA-256 must match before anything is
 * extracted. Idempotent: a `<binary>.version` marker records the staged version + zip digest; if the
 * binary is present and matches (or, without a marker, reports `opencode v<version>`), nothing is done.
 */
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { createWriteStream, existsSync } from "node:fs"
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import { fileURLToPath } from "node:url"

const PINNED_VERSION = "2.2.5"
const REPO = process.env.OPENCODE_REPO ?? "anomalyco/opencode"
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
let BIN_DIR = join(ROOT, "src-tauri", "binaries")

/** Rust target triple → upstream release asset. */
const ASSETS = {
  "aarch64-apple-darwin": "opencode-darwin-arm64.zip",
  "x86_64-apple-darwin": "opencode-darwin-x64.zip",
}

function parseArgs(argv) {
  const opts = { targets: [], dryRun: false, force: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--dry-run" || a === "-n") opts.dryRun = true
    else if (a === "--force" || a === "-f") opts.force = true
    else if (a === "--target" || a === "-t") opts.targets.push(argv[++i])
    else if (a.startsWith("--target=")) opts.targets.push(a.slice("--target=".length))
    else if (a === "--out-dir") BIN_DIR = resolve(argv[++i])
    else if (a === "--help" || a === "-h") {
      console.log("usage: fetch-opencode.mjs [--target <triple>|all] [--dry-run] [--force] [--out-dir <dir>]")
      process.exit(0)
    } else throw new Error(`unknown argument: ${a}`)
  }
  if (opts.targets.length === 0) opts.targets.push(hostTriple())
  if (opts.targets.includes("all")) opts.targets = Object.keys(ASSETS)
  for (const t of opts.targets) {
    if (!(t in ASSETS))
      throw new Error(`unsupported target "${t}" (supported: ${Object.keys(ASSETS).join(", ")}, all)`)
  }
  return opts
}

function hostTriple() {
  try {
    const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" })
    const host = /^host: (.+)$/m.exec(out)?.[1]
    if (host) return host
  } catch {
    // rustc not installed: fall back to Node's view of the platform.
  }
  if (process.platform !== "darwin") throw new Error("Opal ships for macOS only; pass --target explicitly")
  return process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin"
}

function releaseUrl(version, file) {
  return `https://github.com/${REPO}/releases/download/v${version}/${file}`
}

async function fetchOk(url) {
  const res = await fetch(url, { redirect: "follow", headers: { "user-agent": "opal-fetch-opencode" } })
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`)
  return res
}

async function fetchChecksums(version) {
  const text = await (await fetchOk(releaseUrl(version, "SHA256SUMS"))).text()
  const sums = new Map()
  for (const line of text.split("\n")) {
    const m = /^([0-9a-f]{64})\s+\*?(\S+)$/.exec(line.trim())
    if (m) sums.set(m[2], m[1])
  }
  return sums
}

function readMarker(markerPath) {
  return readFile(markerPath, "utf8")
    .then((s) => JSON.parse(s))
    .catch(() => null)
}

/** `opencode --version` → "2.2.5", or null if the binary cannot run on this host. */
function binaryVersion(binPath) {
  try {
    const out = execFileSync(binPath, ["--version"], { encoding: "utf8", timeout: 20_000 }).trim()
    return /v?(\d+\.\d+\.\d+\S*)/.exec(out)?.[1] ?? null
  } catch {
    return null
  }
}

async function downloadVerified(url, dest, expectedSha) {
  const res = await fetchOk(url)
  const total = Number(res.headers.get("content-length") ?? 0)
  const hash = createHash("sha256")
  let seen = 0
  let lastPct = -1
  const meter = new Transform({
    transform(chunk, _enc, cb) {
      hash.update(chunk)
      seen += chunk.length
      const pct = total ? Math.floor((seen / total) * 100) : -1
      if (process.stderr.isTTY && pct !== lastPct && pct % 5 === 0) {
        process.stderr.write(`\r  ${pct}% of ${(total / 1e6).toFixed(1)} MB`)
        lastPct = pct
      }
      cb(null, chunk)
    },
  })
  await pipeline(Readable.fromWeb(res.body), meter, createWriteStream(dest))
  if (process.stderr.isTTY) process.stderr.write("\n")
  const actual = hash.digest("hex")
  if (actual !== expectedSha) {
    throw new Error(`checksum mismatch for ${url}\n  expected ${expectedSha}\n  actual   ${actual}`)
  }
  return actual
}

async function stage(target, version, sums, opts) {
  const asset = ASSETS[target]
  const url = releaseUrl(version, asset)
  const binPath = join(BIN_DIR, `opencode-${target}`)
  const markerPath = `${binPath}.version`
  const expectedSha = sums?.get(asset)

  console.log(`• ${target}: opencode v${version}`)
  console.log(`  asset   ${url}`)
  console.log(`  sha256  ${expectedSha ?? "(SHA256SUMS unavailable)"}`)
  console.log(`  output  ${binPath}`)
  if (sums && !expectedSha) throw new Error(`${asset} is not listed in v${version}/SHA256SUMS`)

  if (!opts.force && existsSync(binPath)) {
    const marker = await readMarker(markerPath)
    if (marker?.version === version && (!expectedSha || marker.sha256 === expectedSha)) {
      console.log("  already staged (marker matches) — skipping")
      return
    }
    if (!marker) {
      const v = binaryVersion(binPath)
      if (v === version) {
        console.log(`  already staged (binary reports v${v}) — recording marker, skipping`)
        if (!opts.dryRun) await writeMarker(markerPath, version, expectedSha, "existing")
        return
      }
      console.log(`  present but version is ${v ?? "unknown"} — will replace`)
    } else {
      console.log(`  present at v${marker.version} — will replace`)
    }
  }

  if (opts.dryRun) {
    console.log("  dry run — not downloading")
    return
  }
  if (!expectedSha) throw new Error("refusing to download without a checksum")

  const work = await mkdtemp(join(tmpdir(), "opal-opencode-"))
  try {
    const zipPath = join(work, asset)
    await downloadVerified(url, zipPath, expectedSha)
    console.log("  checksum OK")

    const entries = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" }).split("\n").filter(Boolean)
    const entry = entries.find((e) => e === "opencode" || e.endsWith("/opencode"))
    if (!entry) throw new Error(`no "opencode" binary inside ${asset} (entries: ${entries.join(", ")})`)
    const outDir = join(work, "x")
    execFileSync("unzip", ["-o", "-q", "-j", zipPath, entry, "-d", outDir])

    await mkdir(BIN_DIR, { recursive: true })
    const tmpBin = `${binPath}.tmp`
    await rename(join(outDir, "opencode"), tmpBin).catch(async () => {
      // Different volume: copy via read/write.
      await writeFile(tmpBin, await readFile(join(outDir, "opencode")))
    })
    await chmod(tmpBin, 0o755)
    await rename(tmpBin, binPath)
    await writeMarker(markerPath, version, expectedSha, url)

    const reported = binaryVersion(binPath)
    console.log(`  staged${reported ? ` (reports v${reported})` : " (cross-arch: not executed)"}`)
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

function writeMarker(markerPath, version, sha256, source) {
  return writeFile(
    markerPath,
    JSON.stringify({ version, sha256, source, stagedAt: new Date().toISOString() }, null, 2) + "\n",
  )
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const version = (process.env.OPENCODE_VERSION ?? PINNED_VERSION).replace(/^v/, "")
  let sums = null
  try {
    sums = await fetchChecksums(version)
  } catch (err) {
    if (!opts.dryRun) throw err
    console.warn(`warning: could not fetch SHA256SUMS (${err.message})`)
  }
  for (const target of opts.targets) await stage(target, version, sums, opts)
}

main().catch((err) => {
  console.error(`fetch-opencode: ${err.message}`)
  process.exit(1)
})
