#!/usr/bin/env node
/**
 * Bump Opal's version everywhere it is declared, in one go:
 *   package.json · src-tauri/tauri.conf.json · src-tauri/Cargo.toml (+ Cargo.lock entry)
 *
 *   node scripts/bump-version.mjs 0.2.0
 *   node scripts/bump-version.mjs patch|minor|major
 *   node scripts/bump-version.mjs 0.2.0 --dry-run
 *
 * Also inserts a "## [x.y.z] — YYYY-MM-DD" heading under "## [Unreleased]" in CHANGELOG.md.
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const spec = args.find((a) => !a.startsWith("--"))
if (!spec) {
  console.error("usage: bump-version.mjs <x.y.z|patch|minor|major> [--dry-run]")
  process.exit(2)
}

const files = {
  pkg: join(ROOT, "package.json"),
  conf: join(ROOT, "src-tauri", "tauri.conf.json"),
  cargo: join(ROOT, "src-tauri", "Cargo.toml"),
  lock: join(ROOT, "src-tauri", "Cargo.lock"),
  changelog: join(ROOT, "CHANGELOG.md"),
}

const current = JSON.parse(readFileSync(files.pkg, "utf8")).version
const next = resolveVersion(current, spec)

function resolveVersion(cur, s) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(cur)
  if (!m) throw new Error(`current version "${cur}" is not semver`)
  const [maj, min, pat] = m.slice(1).map(Number)
  if (s === "major") return `${maj + 1}.0.0`
  if (s === "minor") return `${maj}.${min + 1}.0`
  if (s === "patch") return `${maj}.${min}.${pat + 1}`
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(s)) throw new Error(`not a semver version: ${s}`)
  return s
}

function replaceOnce(text, re, replacement, label) {
  if (!re.test(text)) throw new Error(`could not find the version in ${label}`)
  return text.replace(re, replacement)
}

const edits = []

// package.json / tauri.conf.json: edit textually to preserve formatting.
for (const [key, label] of [
  ["pkg", "package.json"],
  ["conf", "src-tauri/tauri.conf.json"],
]) {
  const text = readFileSync(files[key], "utf8")
  edits.push([files[key], replaceOnce(text, /("version"\s*:\s*")[^"]+(")/, `$1${next}$2`, label)])
}

// Cargo.toml: the `version` key of [package] only.
{
  const text = readFileSync(files.cargo, "utf8")
  const re = /(\[package\][^[]*?\nversion\s*=\s*")[^"]+(")/
  edits.push([files.cargo, replaceOnce(text, re, `$1${next}$2`, "src-tauri/Cargo.toml")])
}

// Cargo.lock: the `opal` package entry.
if (existsSync(files.lock)) {
  const text = readFileSync(files.lock, "utf8")
  const re = /(\[\[package\]\]\nname = "opal"\nversion = ")[^"]+(")/
  edits.push([files.lock, replaceOnce(text, re, `$1${next}$2`, "src-tauri/Cargo.lock")])
}

// CHANGELOG.md
if (existsSync(files.changelog)) {
  const text = readFileSync(files.changelog, "utf8")
  const date = new Date().toISOString().slice(0, 10)
  if (text.includes(`## [${next}]`)) {
    console.log(`CHANGELOG.md already has a ${next} section`)
  } else {
    edits.push([
      files.changelog,
      replaceOnce(text, /## \[Unreleased\]\n/, `## [Unreleased]\n\n## [${next}] — ${date}\n`, "CHANGELOG.md"),
    ])
  }
}

console.log(`Opal ${current} → ${next}${dryRun ? " (dry run)" : ""}`)
for (const [file, content] of edits) {
  console.log(`  ${file.slice(ROOT.length + 1)}`)
  if (!dryRun) writeFileSync(file, content)
}
if (!dryRun) {
  try {
    execFileSync("git", ["-C", ROOT, "diff", "--stat"], { stdio: "inherit" })
  } catch {
    // not a git checkout / no commits yet — fine
  }
  console.log(`\nNext: review CHANGELOG.md, then  git commit -am "Release v${next}" && git tag v${next}`)
}
