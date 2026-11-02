# Engineering conventions

Read `docs/ARCHITECTURE.md` first. These rules apply to every contributor (human or agent).

## Stack

- React 19 + TypeScript strict, Vite 8, Tailwind CSS 4 (`@theme inline` tokens in `src/index.css`), Radix-based
  shadcn-style components in `src/components/ui` (add components there as needed; keep them small and token-driven).
- State: Zustand stores under `src/lib/runtime`. Features consume **only** `runtime` from `@/lib/runtime`
  (contract in `src/lib/runtime/contracts.ts`). Never import `@opencode/client` outside `src/lib/opencode` + `src/lib/runtime`.
- Tauri 2 (Rust 2024 edition). Frontend ↔ Rust via `invoke()` commands registered in `src-tauri/src/lib.rs`
  (module stubs already exist; implement your module, keep command names/signatures). The app must also run in a
  plain browser (`pnpm dev` + `VITE_OPENCODE_URL`) for tests — gate Tauri APIs behind `isTauri()` from `@/lib/utils`.
- Upstream OpenCode source for reference: a local checkout of github.com/anomalyco/opencode at the
  pinned tag (`v2.2.5`; packages/schema, packages/protocol, packages/core, packages/client). Verify any API against it; do not guess.
  The generated client lives in `node_modules/@opencode/client/dist/promise/generated/{client,types}.d.ts`.

## Look & feel (non-negotiable)

- Minimalist, warm neutral surfaces, 1px subtle borders, no cards/gradients/
  oversized headings, restrained motion (≤150ms), serif only for conversation titles/greetings, 15px body.
  Use only the tokens in `src/index.css` (`bg-bg`, `text-fg-secondary`, `border-border`, `rounded-md` …).
- Native macOS feel: title bar overlay with traffic-light inset (already in `TitleBar.tsx`), `user-select: none`
  except content, keyboard shortcuts (⌘N new chat, ⌘K search, ⌘, settings, ⌘⇧A artifact panel, Esc stop).
- Light + dark themes via `data-theme` on `<html>`; never hardcode colors.
- No Anthropic branding/assets. The product is **Opal**.

## Quality bar

- `pnpm typecheck` and `pnpm test` must pass. Add unit tests (vitest + Testing Library) for logic you write
  (projection, mapping, parsing, reducers). Integration tests that need a real OpenCode server go in
  `tests/integration` (`pnpm test:integration`, see the harness there).
- No mocked functionality presented as real. If something cannot be completed, leave a clear `// LIMITATION:` comment
  and a line in `docs/LIMITATIONS.md`.
- Never log, persist in settings.json, or render API keys/passwords (mask with `••••` + last 4).
- Prettier config is in `.prettierrc` (no semicolons, width 110). Run `pnpm format` on files you touch.
- Keep modules focused; prefer small files; export named functions; no `any`.
- Do not edit files outside your ownership area (ARCHITECTURE.md §6) except to add an import/registration a
  reviewer would expect; if you need a contract change, make the minimal change in `contracts.ts` and note it in
  your final report.
- Do not `git commit` (the maintainer commits); do not add API keys; do not run `pnpm tauri build`.

## Running

- Browser dev against a running OpenCode server:
  `OPENCODE_PASSWORD=dev opencode serve --port 4096` (in another terminal, using an isolated config via
  `XDG_CONFIG_HOME=/tmp/opal-dev/config XDG_DATA_HOME=/tmp/opal-dev/data`), then
  `VITE_OPENCODE_URL=http://127.0.0.1:4096 VITE_OPENCODE_PASSWORD=dev pnpm dev` → http://localhost:1420.
- Desktop: `pnpm app:dev` (spawns the sidecar from `src-tauri/binaries/opencode-aarch64-apple-darwin`).
- Headless screenshots: `pnpm exec playwright screenshot --viewport-size=1280,820 http://localhost:1420 shot.png`
  (Chromium is installed). Put screenshots in the scratchpad, not the repo.
