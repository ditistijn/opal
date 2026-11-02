#!/usr/bin/env bash
# Cut an Opal release: build + sign + notarize, write the OTA manifest, tag, and publish a GitHub
# release with every artifact attached.
#
#   pnpm release:mac                 release the version in src-tauri/tauri.conf.json
#   pnpm release:mac -- --dry-run    build and stage everything, publish nothing
#   pnpm release:mac -- --skip-build reuse dist-mac/ from a previous `pnpm build:mac`
#   pnpm release:mac -- --draft      publish as a draft release
#   pnpm release:mac -- --prerelease mark the release as a pre-release (the OTA manifest is still
#                                    attached; the updater only follows /releases/latest, which skips
#                                    pre-releases, so testers install it by hand)
#
# Steps (see docs/RELEASING.md):
#   1. preflight: clean tree on main, version not yet tagged, `gh` authenticated, notary profile present
#   2. scripts/build-mac.sh (Developer ID signature, notarization, OTA bundle signed with the updater key)
#   3. dist-mac/latest.json — the manifest tauri-plugin-updater polls (docs/UPDATES.md)
#   4. git tag v<version> (annotated) + push
#   5. gh release create with the CHANGELOG section as notes and the DMG, zip, OTA bundle, signature,
#      checksums and latest.json attached
#
# Environment
#   OPAL_REPO     GitHub repository, default "ditistijn/opal"
#   plus everything scripts/build-mac.sh reads (signing identity, notary profile, updater key)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DRY_RUN=0
SKIP_BUILD=0
DRAFT=0
PRERELEASE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    --draft) DRAFT=1 ;;
    --prerelease) PRERELEASE=1 ;;
    -h|--help) sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

REPO="${OPAL_REPO:-ditistijn/opal}"
OUT="$ROOT/dist-mac"
VERSION="$(node -p "require('./src-tauri/tauri.conf.json').version")"
TAG="v$VERSION"
ARCH="$(rustc -vV | sed -n 's/^host: //p' | cut -d- -f1)"      # aarch64 | x86_64
case "$ARCH" in
  aarch64) PLATFORM="darwin-aarch64" ;;
  x86_64) PLATFORM="darwin-x86_64" ;;
  *) echo "unsupported host arch: $ARCH" >&2; exit 1 ;;
esac
SUFFIX="$VERSION-$ARCH"

bold() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[33mwarning:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------------------------
bold "Preflight — Opal $VERSION ($PLATFORM) → github.com/$REPO"
for tool in gh git node shasum; do command -v "$tool" >/dev/null || die "missing tool: $tool"; done
gh auth status >/dev/null 2>&1 || die "gh is not authenticated (gh auth login)"
[[ "$(git branch --show-current)" == main ]] || warn "not on main (releasing from $(git branch --show-current))"
if [[ -n "$(git status --porcelain)" ]]; then
  git status --short | head -20 >&2
  die "working tree is not clean — commit or stash first"
fi
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  die "tag $TAG already exists locally (bump the version: node scripts/bump-version.mjs patch)"
fi
if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  die "release $TAG already exists on GitHub"
fi
for f in package.json src-tauri/Cargo.toml; do
  v="$(node -p "const f=require('fs').readFileSync('$f','utf8');const m=f.match(/^version\\s*=\\s*\"([^\"]+)\"/m)||JSON.parse(f).version&&[0,JSON.parse(f).version];m?m[1]:''" 2>/dev/null || true)"
  [[ -z "$v" || "$v" == "$VERSION" ]] || die "$f says version $v, tauri.conf.json says $VERSION (node scripts/bump-version.mjs $VERSION)"
done

# Release notes = the CHANGELOG section for this version.
NOTES_FILE="$(mktemp -t opal-notes)"
node - "$VERSION" > "$NOTES_FILE" <<'EOF'
const [, , version] = process.argv
const md = require("fs").readFileSync("CHANGELOG.md", "utf8")
const re = new RegExp(`^## \\[${version.replace(/\./g, "\\.")}\\][^\\n]*\\n([\\s\\S]*?)(?=^## \\[|(?![\\s\\S]))`, "m")
const m = md.match(re)
if (!m || !m[1].trim()) {
  console.error(`CHANGELOG.md has no "## [${version}]" section with content`)
  process.exit(1)
}
process.stdout.write(m[1].trim() + "\n")
EOF
echo "Release notes ($(wc -l < "$NOTES_FILE" | tr -d ' ') lines):"
sed 's/^/  /' "$NOTES_FILE" | head -30

# ---------------------------------------------------------------------------------------------
if [[ "$SKIP_BUILD" == 1 ]]; then
  bold "Build — skipped (reusing $OUT)"
else
  bold "Build"
  bash scripts/build-mac.sh
fi

DMG="$OUT/Opal-$SUFFIX.dmg"
ZIP="$OUT/Opal-$SUFFIX.app.zip"
SUMS="$OUT/Opal-$SUFFIX.sha256"
UPD="$OUT/Opal-$SUFFIX.app.tar.gz"
SIG="$UPD.sig"
for f in "$DMG" "$ZIP" "$SUMS" "$UPD" "$SIG"; do
  [[ -f "$f" ]] || die "missing artifact: $f (a release needs the OTA bundle; is the updater key installed? docs/UPDATES.md)"
done
spctl --assess --type execute --verbose=2 "$OUT/Opal.app" 2>&1 | grep -q "Notarized Developer ID" \
  || die "dist-mac/Opal.app is not notarized — releases must be (docs/BUILD.md §4)"

# ---------------------------------------------------------------------------------------------
bold "OTA manifest → dist-mac/latest.json"
MANIFEST="$OUT/latest.json"
node - "$VERSION" "$PLATFORM" "$REPO" "$TAG" "$(basename "$UPD")" "$SIG" "$NOTES_FILE" > "$MANIFEST" <<'EOF'
const [, , version, platform, repo, tag, asset, sigFile, notesFile] = process.argv
const fs = require("fs")
const signature = fs.readFileSync(sigFile, "utf8").trim()
const notes = fs.readFileSync(notesFile, "utf8").trim()
const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    [platform]: {
      signature,
      url: `https://github.com/${repo}/releases/download/${tag}/${asset}`,
    },
  },
}
process.stdout.write(JSON.stringify(manifest, null, 2) + "\n")
EOF
node -e "const m=require('$MANIFEST');console.log('  version', m.version);for (const [p,v] of Object.entries(m.platforms)) console.log(' ', p, '→', v.url)"

ASSETS=("$DMG" "$ZIP" "$UPD" "$SIG" "$SUMS" "$MANIFEST")

if [[ "$DRY_RUN" == 1 ]]; then
  bold "Dry run — nothing tagged or published"
  printf '  would tag %s and upload:\n' "$TAG"
  printf '    %s\n' "${ASSETS[@]}"
  exit 0
fi

# ---------------------------------------------------------------------------------------------
bold "Tag $TAG"
git tag -a "$TAG" -m "Opal $VERSION"
git push origin HEAD
git push origin "$TAG"

bold "GitHub release"
GH_ARGS=(release create "$TAG" --repo "$REPO" --title "Opal $VERSION" --notes-file "$NOTES_FILE" --verify-tag)
[[ "$DRAFT" == 1 ]] && GH_ARGS+=(--draft)
[[ "$PRERELEASE" == 1 ]] && GH_ARGS+=(--prerelease)
gh "${GH_ARGS[@]}" "${ASSETS[@]}"
URL="$(gh release view "$TAG" --repo "$REPO" --json url --jq .url)"

bold "Done"
echo "  $URL"
echo "  updater manifest: https://github.com/$REPO/releases/latest/download/latest.json"
[[ "$DRAFT" == 1 ]] && echo "  (draft: publish it on GitHub before the updater can see it)"
rm -f "$NOTES_FILE"
