# Security: command sandbox and remote control

This page covers two features: the **sandbox** for the agent's shell commands (Settings → Security) and
**remote control** (Settings → Remote control). For artifact isolation, API key storage and permissions, see
`docs/ARCHITECTURE.md` §5.

## 1. Command sandbox (macOS `sandbox-exec`)

### How it works

```
OpenCode shell tool / PTY ──spawn──▶ <Opal root>/bin/sandbox/zsh  (opencode.json "shell")
                                       │ reads bin/sandbox/config.env on every command
                                       ├─ mode off / no sandbox-exec ─▶ exec /bin/zsh "$@"
                                       └─ else ─▶ exec /usr/bin/sandbox-exec -p "<profile>" /bin/zsh "$@"
```

* `src-tauri/src/sandbox_exec.rs` installs the wrapper at every launch (body: `src-tauri/src/sandbox_shell.sh`,
  POSIX sh) and owns `config.env` (`cmd_sandbox_status`, `cmd_sandbox_configure`).
* The wrapper is named `zsh` on purpose. OpenCode derives shell semantics from the basename
  (`packages/core/src/shell/select.ts`): `-c <command>` for the shell tool, `-l` for PTY terminals, and the zsh
  dialect for the permission scanner. Both the shell tool (`resolve({priority: "compat"})`) and PTY terminals
  (`resolve({priority: "config"})`) use the configured `shell`.
* `src/lib/config/build.ts` writes `shell: "<wrapper>"` when the mode is not `off` and the wrapper is available.
  Mode and folder changes only rewrite `config.env`, so they apply to the next command without a restart. Only
  switching to or from `off` regenerates `opencode.json`, and OpenCode reloads it live.
* Defaults: mode `filesystem`. When `config.env` is missing, the wrapper also falls back to `filesystem`.

### Profile

Writable roots, all resolved to real paths (`/tmp` → `/private/tmp`), deduplicated, and quoted with `\` and `"`
escaped:

| Root | When |
| --- | --- |
| the command's working directory (= the session folder: chat sandbox, repo or worktree) | unless it is `/`, `~`, an ancestor of `~`, or a system folder such as `/Users`, `/Library` or `/usr` |
| the enclosing git work tree (`git rev-parse --show-toplevel`) | inside a git repo (same guard) |
| the main repo's common `.git` dir (`--git-common-dir`) | linked worktrees only, so commits work; its `hooks/` stays read-only |
| `$TMPDIR`, `/private/tmp`, `/private/var/folders`, `/dev` | always |
| `~/.npm`, `~/.cache`, `~/Library/Caches`, `~/.pnpm-store`, `~/Library/pnpm`, `~/.cargo/registry`, `~/.bun/install/cache`, `~/.yarn/berry/cache`, `~/.gradle/caches`, `~/.m2/repository`, `~/go/pkg/mod` | `filesystem` mode, if they exist |
| Settings → Security → extra writable folders | always |
| `~/.zsh_history` (+ `.LOCK`, `.new`) | interactive shells only (no `-c`) |

Always denied, even when an allowed root contains them (later rules win in SBPL): `<Opal root>/bin/sandbox`
(the wrapper and its config), `<Opal root>/opencode/config` (`opencode.json`, which names the shell) and
`<Opal root>/settings.json`.

This is the exact profile generated in **strict** mode for a chat whose folder is
`<Opal root>/conversations/ses_example`, printed with `OPAL_SANDBOX_PRINT_PROFILE=1 <wrapper> -c true`:

```scheme
(version 1)
(allow default)
(deny file-write*)
(allow file-write*
  (subpath "<Opal root>/conversations/ses_example")
  (subpath "/private/var/folders/_s/…/T")
  (subpath "/private/tmp")
  (subpath "/private/var/folders")
  (subpath "/dev")
  (literal "/dev/null")
  (regex #"^/dev/tty"))
(deny file-write*
  (subpath "<Opal root>/bin/sandbox")
  (subpath "<Opal root>/opencode/config")
  (literal "<Opal root>/settings.json"))
(deny network-outbound)
(allow network-outbound (remote ip "localhost:*"))
```

`filesystem` mode is the same minus the two `network-outbound` lines, plus the cache folders listed above.

### Verified behaviour (macOS 26, `tests/integration/sandbox.test.ts`)

* A write in the session folder succeeds. Writes to `~/Desktop` and to sibling folders fail with
  `zsh: operation not permitted`. This holds when the wrapper is run directly, through
  `opencode serve` with `shell` set (`session.shell`), and through a real agent turn started from a paired phone.
* Strict: `curl https://example.com` fails (`Could not resolve host`), connecting to `1.1.1.1:443` fails, and
  `http://127.0.0.1:<port>` works. Filesystem mode: `HTTP/2 200`.
* A commit from a linked worktree succeeds. Writing `<main>/.git/hooks/pre-commit` or `<main>/escape.txt` is denied.
* An interactive `zsh -l` over a PTY works (it is a login shell and loads the user's `.zshrc`), with the same write rules.
* Writing `config.env` from inside the sandbox is denied, even when its parent folder is an allowed root.

### What it protects, and what it does not

Protects against:
* a command (or a script it runs, such as `npm install` postinstall hooks or a test suite) **modifying or deleting
  files outside the working folder**, for example `rm -rf ~` or edits to dotfiles or other projects;
* in strict mode, **shell commands sending data to the network** (exfiltration through `curl`, package managers and
  scripts) and downloading code.

Does **not** protect against:
* **reading** files. Commands can read anything your user can read (`~/.ssh`, browser profiles, other repos).
  Strict mode prevents commands from *sending* that data out, but the model itself sees whatever it reads and
  sends it to your model provider.
* the agent's **own file tools** (`write`, `edit`, `patch`). They run inside OpenCode, not the shell, and are
  governed by OpenCode permissions (`external_directory: ask` outside the working folder; Code "ask" mode asks
  for every edit).
* anything in the writable roots: the repo itself (for example adding a malicious `package.json` script or
  `.git/hooks` in the repo you are working in, which runs later outside the sandbox), temp and cache folders.
* network access in `filesystem` mode, or to `localhost` services in strict mode (databases, the Docker
  socket over TCP, other local servers).
* MCP servers, LSP servers, and the OpenCode process itself, which all run unsandboxed.
* a working directory you approved outside the session folder: the sandbox follows the command's working
  directory, so OpenCode's external-directory prompt is what guards it (home and system folders are never
  made writable).
* `sandbox-exec` is deprecated by Apple (it still works on current macOS). If it disappears, commands run
  unsandboxed and Settings → Security says so.

## 2. Remote control

### Design

* **Off by default.** When on (`remote_web.rs`):
  * the sidecar is restarted with `--hostname 0.0.0.0 --port <stable port, 47801 by default>` and one `--cors`
    for each origin the web UI is served from (`http://<each LAN IPv4>:<web port>` and
    `http://<LocalHostName>.local:<web port>`);
  * its password comes from `<Opal root>/remote/secret` (mode 0600 in a 0700 folder) rather than a fresh random
    one, so pairing tokens survive restarts;
  * a minimal static HTTP server serves the Opal frontend on `0.0.0.0:<web port, 47800 by default>`. It serves
    GET/HEAD for public frontend files only (no API, no credentials, path traversal rejected).
* **Pairing**: Opal calls `POST /api/pair` (authenticated, local), which returns a random 128-bit code that is
  single use and valid for 5 minutes. The QR code and link carry `http://<ip>:<web port>/#rc=<base64url {url, code}>`.
  The code is in the URL fragment, which browsers never send to a server. The page redeems it with
  `GET <sidecar>/auth/connect/<code>` and `Accept: application/json`, gets a session token
  (`<expiry>.<HMAC-SHA256>`, valid for 30 days, signed with a key derived from the server password), stores
  it in the device's `localStorage`, and strips the fragment.
* **Turning remote control off** stops the web server, deletes the secret and rebinds the sidecar to
  `127.0.0.1` with a new random password, which revokes every paired device. **Sign out all devices** rotates
  the secret while staying on.
* The server password never leaves the Mac. Unauthenticated requests get 401 on every route except
  `/auth/connect/:code`, which only accepts a valid unused code.

### Threat model

| Threat | Mitigation | Residual risk |
| --- | --- | --- |
| Someone on the same network reaches the server | Every API call needs the password or a valid token. Codes are 128-bit, single use and expire after 5 minutes | They can see that Opal is running (open ports, the public web UI files) |
| **Passive sniffing on the LAN** | none: traffic is plain HTTP | Tokens and conversation content are visible to anyone who can sniff the network (open Wi-Fi, a compromised router). **Use trusted networks**, or Tailscale/WireGuard, which encrypt end to end |
| Stolen/lost phone | Turn remote control off or use **Sign out all devices** | A token is valid for up to 30 days until revoked |
| Malicious website in the phone's or Mac's browser calling the API | Tokens live in `localStorage` of Opal's origin, not in cookies (the JSON redemption sets no cookie), so other sites have no credential to send. CORS adds only Opal's LAN origins to OpenCode's built-in list (localhost, Tauri, `*.opencode.ai`) | XSS in the Opal web UI would expose the token, as it would in any web app |
| Pairing link leaks (screenshot, chat history) | Single use, 5-minute expiry | A leaked link can be redeemed by whoever uses it first; regenerate if in doubt |
| Paired device drives the agent | Same permissions and sandbox as on the Mac: agent prompts and shell commands run on the Mac | A paired device has full control of Opal's sessions; only pair devices you own |
| Exposure to the internet | Opal never opens a tunnel or a router port | If you forward ports yourself, you expose unencrypted HTTP; use Tailscale or SSH instead (docs/LIMITATIONS.md) |

The fallback link "OpenCode web UI" (`http://<ip>:<sidecar port>/auth/connect/<code>`) uses the same code.
A browser that opens it gets an `httpOnly` session cookie and OpenCode's bundled web app.

## Engine isolation from agent commands (added 2026-11-01)

A model once used the shell tool to curl Opal's own OpenCode API and to create "probe" artifacts. Three layers now
stop that:

1. **Prompts** forbid probing the app, its local server, ports, config, databases, environment or credentials, and
   forbid test/probe artifacts (resources/prompts/*.md).
2. **Environment scrub.** The sandbox wrapper (`<root>/bin/sandbox/zsh`) is the configured shell in every mode,
   including "off", and always unsets `OPENCODE_PASSWORD` / `OPENCODE_SERVER_PASSWORD` before running zsh.
3. **SBPL rules** (filesystem and strict modes): reads of `<root>/opencode/{data,config,state}` (SQLite with provider
   keys, generated config), `<root>/remote/secret`, `<root>/logs`, `settings.json`, the wrapper's own folder and the
   user's own `~/.config/opencode`, `~/.local/share/opencode`, `~/.local/state/opencode` are denied; Code worktrees
   under the data dir and the working roots stay readable. Outbound connections to the engine's loopback port and the
   remote-control ports (47800/47801) are denied (`OPAL_SANDBOX_DENY_PORTS` in config.env, published by the sidecar).

Covered by `tests/integration/sandbox.test.ts` (env scrub, secret reads, worktree reads, port deny).
