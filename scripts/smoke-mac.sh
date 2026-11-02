#!/usr/bin/env bash
# Automated acceptance run of the desktop app (docs/VERIFICATION.md "Automated acceptance run").
#
#   scripts/smoke-mac.sh [--no-build] [--keep] [--model <providerID/modelID>] [--timeout-ms <n>]
#
# Builds a debug app once (`pnpm tauri build --debug --no-bundle` → src-tauri/target/debug/opal, frontend
# embedded), then launches it twice against an isolated data dir (OPAL_HOME=/private/tmp/opal-smoke-<pid>/home):
#
#   1. phase "create": imports providers from ~/.config/opencode/opencode.json, creates a chat, sends the two
#      acceptance prompts, checks the artifact, the artifact:// protocol, the in-app preview and versions;
#   2. phase "reopen": relaunches the app on the same data, checks the conversation, transcript, settings and
#      that the artifact pane opens by default and renders.
#
# The app runs the scripted workflow itself (src/lib/smoke, enabled by OPAL_SMOKE) and exits when done; each
# phase writes <OPAL_HOME>/logs/smoke-<name>.json. Prints a PASS/FAIL table per phase; exits non-zero on failure.
#
# Options
#   --no-build            reuse the existing src-tauri/target/debug/opal
#   --keep                keep the scratch dir (reports, logs, data) instead of deleting it
#   --model p/m           model to use (default: the CLI config's "model", else zai/glm-5.3)
#   --timeout-ms n        per-turn timeout inside the app (default 900000 = 15 min; GLM can reason for minutes)
#   -h, --help
#
# Never touches ~/Library/Application Support/Opal. API keys are never printed (only provider ids).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD=1
KEEP=0
MODEL=""
TIMEOUT_MS=900000
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-build) BUILD=0 ;;
    --keep) KEEP=1 ;;
    --model) MODEL="$2"; shift ;;
    --model=*) MODEL="${1#--model=}" ;;
    --timeout-ms) TIMEOUT_MS="$2"; shift ;;
    --timeout-ms=*) TIMEOUT_MS="${1#--timeout-ms=}" ;;
    -h|--help) sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

bold() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

[[ "$(uname -s)" == "Darwin" ]] || die "macOS only"
command -v jq >/dev/null || die "jq is required (brew install jq)"

APP="$ROOT/src-tauri/target/debug/opal"
CLI_CONFIG="$HOME/.config/opencode/opencode.json"
if [[ -z "$MODEL" ]]; then
  [[ -f "$CLI_CONFIG" ]] && MODEL="$(jq -r '.model // empty' "$CLI_CONFIG" 2>/dev/null || true)"
  MODEL="${MODEL:-zai/glm-5.3}"
fi
[[ "$MODEL" == */* ]] || die "--model must look like providerID/modelID (got: $MODEL)"
PROVIDER_ID="${MODEL%%/*}"
MODEL_ID="${MODEL#*/}"

if [[ "$BUILD" == 1 ]]; then
  bold "Build debug app (pnpm tauri build --debug --no-bundle)"
  (cd "$ROOT" && pnpm tauri build --debug --no-bundle)
fi
[[ -x "$APP" ]] || die "app binary not found: $APP (run without --no-build)"

SCRATCH="/private/tmp/opal-smoke-$$"
HOME_DIR="$SCRATCH/home"
mkdir -p "$HOME_DIR"
APP_PID=""
cleanup() {
  if [[ -n "$APP_PID" ]] && kill -0 "$APP_PID" 2>/dev/null; then
    kill -TERM "$APP_PID" 2>/dev/null || true
    sleep 3
    kill -KILL "$APP_PID" 2>/dev/null || true
  fi
  # The app stops its sidecar on exit; a sidecar left behind by a killed app is stopped via its pidfile.
  local pidfile="$HOME_DIR/logs/opencode.pid"
  if [[ -f "$pidfile" ]]; then
    local pid; pid="$(cat "$pidfile" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && ps -p "$pid" -o comm= 2>/dev/null | grep -q opencode; then
      kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    fi
  fi
  if [[ "$KEEP" == 1 ]]; then echo "kept: $SCRATCH"; else rm -rf "$SCRATCH"; fi
}
trap cleanup EXIT

# run_phase <name> <config.json> <deadline seconds> → leaves the report at $HOME_DIR/logs/smoke-<name>.json
run_phase() {
  local name="$1" config="$2" deadline="$3"
  local log="$SCRATCH/$name.app.log" started now
  bold "Phase $(jq -r .phase "$config") ($name) — log: $log"
  rm -f "$HOME_DIR/logs/smoke-$name.json"
  OPAL_HOME="$HOME_DIR" OPAL_SMOKE="$config" "$APP" >"$log" 2>&1 &
  APP_PID=$!
  started=$(date +%s)
  while kill -0 "$APP_PID" 2>/dev/null; do
    now=$(date +%s)
    if (( now - started > deadline )); then
      echo "phase $name exceeded ${deadline}s; stopping the app" >&2
      kill -TERM "$APP_PID" 2>/dev/null || true
      sleep 5
      kill -KILL "$APP_PID" 2>/dev/null || true
      break
    fi
    if (( (now - started) % 60 == 0 )); then
      printf '  … %ds\n' "$((now - started))"
    fi
    sleep 1
  done
  local code=0
  wait "$APP_PID" 2>/dev/null || code=$?
  APP_PID=""
  echo "app exited with code $code after $(( $(date +%s) - started ))s"
}

print_table() {
  local report="$1"
  if [[ ! -f "$report" ]]; then
    echo "FAIL  (no report written: $report)"
    return
  fi
  jq -r '"\(.name) [\(.phase)] → \(if .ok then "PASS" else "FAIL" end)  (\(.startedAt) … \(.finishedAt))  engine \(.env.version // "?")"' "$report"
  {
    printf 'RESULT\tSTEP\tTIME\tWHAT\tNOTE\n'
    jq -r '.steps[] | [
      (if .ok then "PASS" else "FAIL" end),
      .id,
      ((.ms / 1000 * 10 | floor) / 10 | tostring + "s"),
      .title,
      (.error // (
        .detail as $d | [
          ($d.artifactID // empty | "artifact " + .),
          ($d.tools // empty | "tools " + join(",")),
          ($d.src // empty | "src " + (.[0:72])),
          ($d.versions // empty | if type == "array" then "versions \(length)" else "versions \(.)" end),
          ($d.model // empty | "model " + .),
          ($d.imported // empty | "imported \(.)"),
          ($d.user // empty | "user msgs \(.)")
        ] | join(" · ")
      ))
    ] | @tsv' "$report"
  } | column -t -s $'\t'
}

CREATE_CFG="$SCRATCH/create.json"
jq -n --arg p "$PROVIDER_ID" --arg m "$MODEL_ID" --argjson t "$TIMEOUT_MS" '{
  name: "accept",
  phase: "create",
  prompt1: "Create a beautiful interactive network monitoring dashboard.",
  prompt2: "Add a latency graph and make the dashboard dark.",
  model: { providerID: $p, id: $m },
  importCliConfig: true,
  timeoutMs: $t,
  exit: true
}' >"$CREATE_CFG"
echo "data dir: $HOME_DIR · model: $MODEL"

run_phase accept "$CREATE_CFG" $(( TIMEOUT_MS * 2 / 1000 + 600 ))
CREATE_REPORT="$HOME_DIR/logs/smoke-accept.json"

REOPEN_REPORT="$HOME_DIR/logs/smoke-accept-reopen.json"
SESSION_ID="$( [[ -f "$CREATE_REPORT" ]] && jq -r '.sessionID // empty' "$CREATE_REPORT" || true)"
ARTIFACT_ID="$( [[ -f "$CREATE_REPORT" ]] && jq -r '.artifactID // empty' "$CREATE_REPORT" || true)"
if [[ -n "$SESSION_ID" && -n "$ARTIFACT_ID" ]]; then
  REOPEN_CFG="$SCRATCH/reopen.json"
  jq -n --arg s "$SESSION_ID" --arg a "$ARTIFACT_ID" --arg p "$PROVIDER_ID" --arg m "$MODEL_ID" '{
    name: "accept-reopen", phase: "reopen", sessionID: $s, artifactID: $a,
    model: { providerID: $p, id: $m }, exit: true
  }' >"$REOPEN_CFG"
  run_phase accept-reopen "$REOPEN_CFG" 600
else
  echo "skipping reopen: the create phase produced no session/artifact id" >&2
fi

bold "Results"
print_table "$CREATE_REPORT"
echo
if [[ -n "$SESSION_ID" && -n "$ARTIFACT_ID" ]]; then print_table "$REOPEN_REPORT"; else echo "accept-reopen → FAIL (not run)"; fi

OK=1
[[ -f "$CREATE_REPORT" ]] && jq -e '.ok == true' "$CREATE_REPORT" >/dev/null || OK=0
[[ -f "$REOPEN_REPORT" ]] && jq -e '.ok == true' "$REOPEN_REPORT" >/dev/null || OK=0
echo
if [[ "$OK" == 1 ]]; then
  printf '\033[32mPASS\033[0m both phases\n'
else
  printf '\033[31mFAIL\033[0m (reports: %s)\n' "$HOME_DIR/logs"
  [[ "$KEEP" == 1 ]] || echo "re-run with --keep to inspect the reports, app logs and data"
  exit 1
fi
