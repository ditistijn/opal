# Code surface

The **Code** tab (title-bar switcher → `code`) is Opal's agentic coding surface:
agent sessions grouped by git repository, optional isolated worktrees, a transcript with inline diffs and
shell output, and a right pane with Diff, Terminal, Subagents and Files.

Entry point: `src/features/code/CodeSurface.tsx` (default export `CodeSurface`). The title-bar indicator is
`CodeStatusDot` from `src/features/code/CodeStatusDot.tsx` (mounted by the shell, not by the surface).

## Layout

| Area               | File                                                                       | Notes                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sidebar            | `CodeSidebar.tsx`                                                          | Repositories (from `listRepos`, "Open folder…", and `localStorage["opal.code.repos"]`), sessions per repo with status dot, branch/worktree badge and relative time; per-repo menu: New session, Worktrees…, Reveal in Finder (desktop), Remove from list. Collapses to a rail.                                                                                                                   |
| Home               | `CodeHome.tsx`                                                             | "What should we build?" composer with repo picker and Isolated worktree / Local checkout toggle. Empty state when no repo is open.                                                                                                                                                                                                                                                               |
| New session dialog | `NewSessionDialog.tsx`                                                     | ⌘N. Repository, optional title, worktree switch (default `settings.codeSurface.useWorktrees`), base branch (`vcs.branch.list`), new branch name (default `opal/<slug of title>`), mode (default `code`), model (`ModelSelector`).                                                                                                                                                                |
| Session view       | `CodeSessionView.tsx`                                                      | Header: click-to-rename title, repo › branch, worktree path chip, mode · model, Stop, Archive, panel toggle (container queries keep it tidy when the pane is open). Transcript = chat `MessageList` with `ToolRowContext` → `tool-detail.tsx`. Composer placeholder "Describe what to build or fix…", draft key `code:<id>`.                                                                     |
| Permission prompts | chat `PermissionCard` with `variant="code" shortcuts`                      | "Allow Opal to …?" with the command shown as `$ cmd`; Allow once (⌘⏎) / Always / Deny (Esc). Only the first pending card owns the shortcuts.                                                                                                                                                                                                                                                     |
| Right pane         | `RightPane.tsx`                                                            | Resizable (drag the left edge, min 320 px, ≤ 70 %), collapsible, tab + width persisted in `opal.code.nav`.                                                                                                                                                                                                                                                                                       |
| Diff               | `DiffPane.tsx`, `DiffView.tsx`, `diff-parse.ts`                            | Source **Session** (`useSessionDiff`) or **Working tree** (`vcs.diff` mode `working`, untracked files included). File list with A/M/D and +/− counts, unified/split (persisted), Shiki highlighting per side, Refresh, copy patch (all / per file), Open file → Files tab.                                                                                                                       |
| Terminal           | `TerminalPane.tsx`, `XtermView.tsx`, `terminal-store.ts`, `xterm-theme.ts` | xterm.js on an OpenCode PTY in the session directory. Multiple tabs; closing a tab removes the PTY; on first visit it re-attaches PTYs still running in that directory (after a reload) before creating a new one. Resize → `pty.update`, reconnect with backoff resuming from the last cursor, "Process exited" overlay with Restart, themed from Opal tokens (re-themes on light/dark switch). |
| Subagents          | `SubagentsPane.tsx`                                                        | Tree of child sessions (`parentID`) with status, model, agent and time; click opens a read-only transcript drawer (`MessageList readOnly`). Tool rows for the `subagent` tool link to it too.                                                                                                                                                                                                    |
| Files              | `FilesPane.tsx`                                                            | Lazy tree via `file.list` (hides `.git`, `.DS_Store`), read-only viewer via `file.read` with line numbers and Shiki (first 512 KB, binary detection).                                                                                                                                                                                                                                            |
| Worktrees sheet    | `WorktreesSheet.tsx`                                                       | Per repo: worktree directory, live branch, sessions using it (click to open), Open in Finder (desktop), Remove → confirm → on refusal ("contains modified or untracked files") shows the git error and offers **Force remove**. The branch is kept.                                                                                                                                              |

## Keyboard

| Keys | Action                                                                                                          |
| ---- | --------------------------------------------------------------------------------------------------------------- |
| ⌘N   | New session dialog (current/home repo preselected)                                                              |
| ⌘⇧D  | Toggle the right pane on the Diff tab                                                                           |
| ⌘`   | Toggle the right pane on the Terminal tab (works from inside the terminal)                                      |
| ⌘,   | Settings                                                                                                        |
| Esc  | Stop the session when it is running — unless a permission card is pending (Esc = Deny) or a dialog/menu is open |
| ⌘⏎   | Allow once on the first pending permission                                                                      |

## Runtime

Features only import `runtime` from `@/lib/runtime` and `codeRuntime` from `@/lib/runtime/code`.

`src/lib/runtime/code.ts` — `CodeRuntime`:

- **Repos**: `useRepos`, `refreshRepos`, `openRepo(dir)` (persists to `opal.code.repos`), `forgetRepo`.
- **Worktrees**: `useWorktrees(repo)` (`worktree.list` by project ID), `useWorktreeIndex()` (worktree dir → repo dir, used to group sessions), `refreshWorktrees`, `removeWorktree(repo, dir, force)`.
- **VCS**: `useBranch(dir)` (`vcs.get`, live via `vcs.branch.updated`), `listBranches`, `workingDiff(dir)`, `refreshSessionDiff(id)`.
- **Files**: `listFiles(dir, path?)` (trailing slashes on directory entries are stripped), `readFile`.
- **PTY**: `create`, `list` (running PTYs whose `cwd` is the directory), `connect` → `connectPty` (ticket from `pty.connect.token`, WebSocket `/api/pty/:id/connect?location[directory]=…&ticket=…&cursor=…`; binary frames starting with `0x00` carry `{cursor}`; close 4404/1000 = exited), `resize` (`pty.update`), `close` (`pty.remove`).

Contract changes in `src/lib/runtime/contracts.ts`:

- `createSession` accepts `repoDirectory?` and `worktreeBranch?` (stored in Opal session metadata so worktree sessions group under their repository and show their branch).
- `createWorktree(repoDirectory, base?, branch?)`. Upstream `worktree.create`'s `branch` field is the **ref** to check out (detached); Opal passes the base there, then runs `git switch -c <branch>` in the new worktree through the shell API so the session gets a named branch. If that fails, the session keeps the detached checkout and the badge shows the base ref.

Session flow (`start-session.ts`): with a worktree → `createWorktree(repo, base, branch ?? "opal/<slug>")` → `createSession({surface:"code", directory: worktree, repoDirectory, worktreeBranch, mode, model, title})`; without → `createSession({surface:"code", directory: repo, mode, model, title})`. Then the session opens and an optional first prompt is sent.

Status: `code-status.ts` (`useCodeStatus`) collects per-session status (`idle` / `busy` / `queued` / `permission`) from invisible `CodeStatusReporter`s; `CodeStatusDot` shows a dot and a count when the Code surface has running or waiting sessions.

## Mock mode

`VITE_OPAL_MOCK=1 pnpm dev` seeds two repos (`acme-api`, `marketing-site`), two worktrees, sessions with edit/shell/subagent tool calls, a pending `bash` permission, child sessions, a fake file tree and a simulated line-echo terminal (`src/lib/runtime/mock/code.ts`).

## Tests

`tests/unit/code/`: sidebar grouping and rows, new-session dialog → `createWorktree`/`createSession` arguments (worktree vs local, explicit branch, inline errors), patch parsing and the diff pane (session vs working tree), subagent tree and drawer, permission-card keyboard, surface keyboard (Esc vs pending permission, ⌘⇧D), `connectPty` (cursor resume, exit codes), terminal adoption.
