# Body of the Opal sandbox shell (<root>/bin/sandbox/zsh). sandbox_exec.rs prepends "#!/bin/sh" and the
# SANDBOX_DIR / OPAL_ROOT assignments, then installs it at launch. tests/integration/sandbox.test.ts runs it too.
REAL_SHELL=/bin/zsh
SBX=/usr/bin/sandbox-exec
nl='
'
# Commands must never inherit the engine's credentials, whatever the sandbox mode.
unset OPENCODE_PASSWORD OPENCODE_SERVER_PASSWORD OPENCODE_API_KEY

mode=filesystem
allow=
deny_ports=
if [ -f "$SANDBOX_DIR/config.env" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case $line in
      OPAL_SANDBOX_MODE=*) mode=${line#OPAL_SANDBOX_MODE=} ;;
      OPAL_SANDBOX_ALLOW=*) allow=${line#OPAL_SANDBOX_ALLOW=} ;;
      OPAL_SANDBOX_DENY_PORTS=*) deny_ports=${line#OPAL_SANDBOX_DENY_PORTS=} ;;
    esac
  done < "$SANDBOX_DIR/config.env"
fi
case $mode in
  off) exec "$REAL_SHELL" "$@" ;;
  filesystem|strict) ;;
  *) mode=filesystem ;;
esac
if [ -z "$OPAL_SANDBOX_PRINT_PROFILE" ] && [ ! -x "$SBX" ]; then
  exec "$REAL_SHELL" "$@"
fi

home=$(CDPATH= cd -- "${HOME:-/var/empty}" 2>/dev/null && pwd -P)
roots=

# real directory path of $1, or nothing (missing, not a directory, or contains a newline)
real_dir() {
  case $1 in ''|*"$nl"*) return 1 ;; esac
  [ -d "$1" ] || return 1
  (CDPATH= cd -- "$1" 2>/dev/null && pwd -P)
}

add_root() {
  r=$(real_dir "$1") || return 0
  case "$nl$roots$nl" in *"$nl$r$nl"*) return 0 ;; esac
  roots="$roots$nl$r"
}

# the working folder (or its git work tree) must not be "everything": /, the home folder or its parents
broad() {
  case $1 in /|/Users|/Volumes|/private|/private/var|/System|/Library|/Applications|/usr|/opt) return 0 ;; esac
  [ "$1" = "$home" ] && return 0
  case "$home/" in "$1"/*) return 0 ;; esac
  return 1
}

esc() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

cwd=$(pwd -P 2>/dev/null)
protect=
if [ -n "$cwd" ] && ! broad "$cwd"; then
  add_root "$cwd"
  d=$cwd
  while :; do
    if [ -e "$d/.git" ]; then
      if command -v git >/dev/null 2>&1; then
        top=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null)
        [ -n "$top" ] && ! broad "$top" && add_root "$top"
        common=$(git -C "$cwd" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
        if [ -n "$common" ] && [ -d "$common" ]; then
          common=$(real_dir "$common")
          case "$common/" in
            "$top"/*) ;;
            *)
              # linked worktree: commits must reach the main repository's .git, but not its hooks
              add_root "$common"
              protect="$protect$nl$common/hooks"
              ;;
          esac
        fi
      fi
      break
    fi
    [ "$d" = / ] && break
    d=$(dirname -- "$d")
  done
fi

# Only the working roots (not temp/cache folders) are re-allowed for reading after the secret denies below.
work_roots=$roots
add_root "${TMPDIR:-/private/tmp}"
add_root /private/tmp
add_root /private/var/folders
add_root /dev
if [ "$mode" = filesystem ] && [ -n "$home" ]; then
  for c in .npm .cache Library/Caches .pnpm-store .cargo/registry .bun/install/cache Library/pnpm .yarn/berry/cache .gradle/caches .m2/repository go/pkg/mod; do
    add_root "$home/$c"
  done
fi
oldifs=$IFS
IFS=:
for p in $allow; do
  IFS=$oldifs
  case $p in /*) add_root "$p" ;; esac
done
IFS=$oldifs

interactive=1
for a in "$@"; do
  [ "$a" = -c ] && interactive=
done

profile='(version 1)
(allow default)
(deny file-write*)
(allow file-write*'
oldifs=$IFS
IFS=$nl
for r in $roots; do
  [ -n "$r" ] && profile="$profile
  (subpath \"$(esc "$r")\")"
done
IFS=$oldifs
if [ -n "$interactive" ] && [ -n "$home" ]; then
  h=$(esc "$home")
  profile="$profile
  (literal \"$h/.zsh_history\") (literal \"$h/.zsh_history.LOCK\") (literal \"$h/.zsh_history.new\")"
fi
profile="$profile
  (literal \"/dev/null\")
  (regex #\"^/dev/tty\"))
(deny file-write*
  (subpath \"$(esc "$SANDBOX_DIR")\")
  (subpath \"$(esc "$OPAL_ROOT/opencode/config")\")
  (literal \"$(esc "$OPAL_ROOT/settings.json")\")"
oldifs=$IFS
IFS=$nl
for r in $protect; do
  [ -n "$r" ] && profile="$profile
  (subpath \"$(esc "$r")\")"
done
IFS=$oldifs
profile="$profile)"
# The engine's database holds provider API keys and its config/remote files hold the server password; the user's
# own OpenCode install has the same. Commands never need them. Later rules win, so the working roots (which may
# live under the data dir for Code worktrees) are re-allowed afterwards.
profile="$profile
(deny file-read*
  (subpath \"$(esc "$OPAL_ROOT/opencode/data")\")
  (subpath \"$(esc "$OPAL_ROOT/opencode/config")\")
  (subpath \"$(esc "$OPAL_ROOT/opencode/state")\")
  (subpath \"$(esc "$OPAL_ROOT/remote")\")
  (subpath \"$(esc "$OPAL_ROOT/logs")\")
  (subpath \"$(esc "$SANDBOX_DIR")\")
  (literal \"$(esc "$OPAL_ROOT/settings.json")\")"
if [ -n "$home" ]; then
  h=$(esc "$home")
  profile="$profile
  (subpath \"$h/.config/opencode\")
  (subpath \"$h/.local/share/opencode\")
  (subpath \"$h/.local/state/opencode\")"
fi
profile="$profile)
(allow file-read*
  (subpath \"$(esc "$OPAL_ROOT/opencode/data/opencode/worktree")\")"
read_roots=$work_roots
oldifs=$IFS
IFS=:
for p in $allow; do
  IFS=$oldifs
  r=$(real_dir "$p") || continue
  case "$nl$read_roots$nl" in *"$nl$r$nl"*) ;; *) read_roots="$read_roots$nl$r" ;; esac
done
IFS=$nl
for r in $read_roots; do
  [ -n "$r" ] && profile="$profile
  (subpath \"$(esc "$r")\")"
done
IFS=$oldifs
profile="$profile)"
# Loopback ports of the Opal engine and its remote-control web server: off-limits in every mode.
oldifs=$IFS
IFS=:
for port in $deny_ports; do
  IFS=$oldifs
  case $port in ''|*[!0-9]*) continue ;; esac
  profile="$profile
(deny network-outbound (remote ip \"localhost:$port\"))"
done
IFS=$oldifs
if [ "$mode" = strict ]; then
  profile="$profile
(deny network-outbound)
(allow network-outbound (remote ip \"localhost:*\"))"
fi

if [ -n "$OPAL_SANDBOX_PRINT_PROFILE" ]; then
  printf '%s\n' "$profile"
  exit 0
fi
exec "$SBX" -p "$profile" "$REAL_SHELL" "$@"
