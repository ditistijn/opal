# System prompts and modes

Opal runs every conversation as one of four OpenCode **agents**, which the UI calls
_modes_. Each has its own complete system prompt.

| Mode                     | Agent id   | Surfaces   | Prompt file                     | Color     |
| ------------------------ | ---------- | ---------- | ------------------------------- | --------- |
| Artifacts (chat default) | `artifact` | chat       | `resources/prompts/artifact.md` | `#D97757` |
| General                  | `general`  | chat       | `resources/prompts/general.md`  | `#87867F` |
| Research                 | `research` | chat       | `resources/prompts/research.md` | `#3F8F5D` |
| Code (code default)      | `code`     | code, chat | `resources/prompts/code.md`     | `#4D6FB4` |

The registry is `MODES` in `src/lib/config/prompts.ts`. It holds label, icon, description,
surfaces and color. Related exports: `MODE_IDS`, `DEFAULT_MODE_FOR_SURFACE`,
`modesForSurface`, `isModeID`.

## How prompts reach the model

1. The built-in prompts are bundled at build time (`?raw` imports) as `BUILTIN_PROMPTS`.
2. User overrides live in `settings.promptOverrides[mode]`. They are edited in
   **Settings → System prompts**.
3. `renderPrompt(mode, builtin, override)` produces the final text:
   - If the override is missing or blank, it returns the built-in prompt.
   - Otherwise it returns the override, with every `{{builtin}}` replaced by the built-in
     prompt. Use this to _extend_ the built-in prompt rather than replace it, for example
     `{{builtin}}\n\nAlways answer in Dutch.`
   - Line endings are normalized to `\n` and the result is trimmed.
4. `renderAllPrompts(overrides)` renders all four. `buildOpenCodeConfig({ settings, prompts })`
   writes each one into `agents.<mode>.system`.

In OpenCode 2.2.5, `agents.<id>.system` **replaces** the base system prompt verbatim.
OpenCode doesn't add its own instructions and doesn't expand template variables. So each
file in `resources/prompts/` must stand alone: identity, environment, tools and policies.

## What each prompt covers

- **artifact.md**: the full artifacts policy:
  - when to create an artifact and when to answer inline
  - supported formats: HTML, React `.tsx` with esm.sh imports and Tailwind, Markdown,
    Mermaid, SVG
  - `artifact_create` / `artifact_read` / `artifact_update`, where update replaces the whole
    file map and keeps the same id
  - embedding data, export requests, the quality bar, and how to talk about artifacts
  - "build it right once": one create/update call with complete files, no probe or test
    artifacts, no poking at the engine, and a size budget (roughly 300–500 lines, one file)
    so the whole file map fits a single response even on models with a small output limit
  - it also covers workspace rules: `uploads/`, `knowledge/`, writing outputs into the folder
  - **Inline widgets** (between "Build it right once" and "Talking about artifacts"): the four
    reserved fences from [INLINE-WIDGETS.md](INLINE-WIDGETS.md) — `chart` (JSON spec, with an
    example that uses `datasets` tabs), `widget` (a complete HTML document; the example is a
    ~40-line savings calculator using the injected theme variables and `window.opal.sendPrompt`),
    `mermaid` and `svg` — plus the exact chart fields, the widget rules (everything inline, CDN
    scripts allowed, theme variables for light/dark, no `100vh`, no API calls, about 150 lines or
    less, never nested in lists/quotes/tables), when to use an inline chart vs. an inline widget vs.
    an artifact, and that inline widgets need no tool call and render as the message streams. It
    tells the model to use them actively (a trend → chart, a what-if → widget) and that one reply
    can mix prose, Markdown and several widgets.
- **general.md**: a concise assistant that makes artifacts only when asked, with a shorter
  "Inline widgets" section (the four fences, the chart fields with one example, the widget rules)
  so it still draws charts and small calculators inline when they help.
- **research.md**: research method with `websearch` and `webfetch`, cross-checking,
  inline-link citations, a Sources list, and stating uncertainty. Its "Inline charts and
  diagrams" section covers the four fences, puts the source in the chart's `note`, and forbids
  charting figures that were not found in (or computed from) sources.
- **code.md**:
  - working in the repository or worktree
  - the loop: plan, read before edit, verify with tests and builds, report
  - git hygiene: no destructive commands; commit only when asked
  - one line on inline `chart` fences for measurements (benchmarks, bundle sizes, test timings)

## Agent options set alongside the prompt

- `description` and `color` come from `MODES`.
- `mode`: `primary` for artifact, research and code. `general` uses `all` because
  OpenCode's built-in `general` agent is a subagent; `all` keeps Opal's mode selectable
  as a primary agent.
- `permissions` are appended to OpenCode's defaults, and the last matching rule wins:
  - **All chat modes**: `external_directory * → ask`.
  - **Code, permission mode "ask"**: `edit * → ask` and `shell * → ask`, plus allow-rules
    for read-only commands (`ls`, `pwd`, `git status/diff/log/show`, `rg`, `which`), then
    `external_directory * → ask`.
  - **Code, permission mode "auto"**: everything allowed except `external_directory → ask`,
    and `shell → ask` for destructive commands (`rm -rf`, `sudo`, `git push`,
    `git reset --hard`, `git clean`, `git checkout --`, `git branch -D`).

## Editing a built-in prompt

1. Edit the file in `resources/prompts/`. Keep it standalone.
2. Run `pnpm test tests/unit/config`. The prompt tests (`tests/unit/config/prompts.test.ts`)
   check these things:
   - every built-in prompt is standalone: more than 2,000 characters, and it mentions
     Markdown, `system-reminder`, parallel tool calls and the core tool names
   - the artifact prompt carries the full artifact policy
   - the code prompt covers worktrees and git hygiene
   - the research prompt requires a Sources list and states uncertainty
   - the chat prompts (artifact, general, research) teach all four inline-widget fences, the
     chart spec and the widget rules; the artifact prompt's examples parse (valid chart JSON, a
     complete widget document), and the code prompt mentions inline charts
3. Users with an override keep their text. Overrides that include `{{builtin}}` pick up
   your change automatically.
