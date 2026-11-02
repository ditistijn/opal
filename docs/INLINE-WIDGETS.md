# Inline widgets

Interactive content rendered **inside an assistant message** (ChatGPT-style): charts, small
calculators, decision helpers, diagrams. They live in the chat column, not in the artifact panel, and
need no `artifact_*` tool call. Owner: chat (`src/features/chat/inline`, `src/components/markdown`,
`public/artifact-runtime/widget.html`).

Artifacts remain the home for full deliverables the user keeps and iterates on (see
[ARTIFACTS.md](ARTIFACTS.md)). Inline widgets are for content that supports the reply itself.

## 1. Authoring contract (what the model writes)

An inline widget is a fenced code block whose info string is one of the reserved languages below. The
block is rendered in place, full message width, in a card. Anything else in the message stays ordinary
Markdown. Widgets must not be nested in lists, quotes or tables.

| Fence          | Body                                                                             | Rendered as                                                                              |
| -------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| ` ```chart `   | JSON chart spec (below)                                                          | Native chart (Recharts), hover tooltips, legend, optional dataset tabs                   |
| ` ```widget `  | A complete self-contained HTML document (CSS and JS inline, CDN scripts allowed) | Sandboxed iframe sized to its content (calculators, decision trees, diagrams, mini apps) |
| ` ```mermaid ` | Mermaid source                                                                   | Diagram (sandboxed iframe, no pan/zoom chrome)                                           |
| ` ```svg `     | An `<svg xmlns="http://www.w3.org/2000/svg" viewBox="…">` document               | Static image (scripts never run)                                                         |

The info string may carry `title="…"` after the language (for example ` ```widget title="Fleet simulator" `);
`chart` takes its title from the spec.

### Chart spec

```chart
{
  "type": "line",
  "title": "Monthly revenue",
  "subtitle": "Illustrative sample data",
  "x": ["Jan", "Feb", "Mar", "Apr"],
  "series": [{ "name": "Revenue", "data": [12000, 15800, 13200, 21500] }],
  "format": "currency:EUR"
}
```

- `type`: `line` | `area` | `bar` | `pie` | `donut`. `line`/`area`/`bar` are cartesian: `x` is the
  category axis, each `series.data` is one number per category. `pie`/`donut` use a single series
  whose `data` entries are `{ "name": "…", "value": 12 }`.
- `series[]`: `{ name, data, color? }`. Colors default to Opal's categorical palette; `color` is an
  optional CSS color.
- `format`: `number` (default) | `compact` | `percent` | `currency:<ISO code>`. Formats the value axis
  and tooltips. `percent` expects fractions (0.12 → 12%).
- `stacked?: boolean` for bar/area. `yMin?`/`yMax?` to pin the value axis. `note?` renders a caption.
- `datasets?: [{ "label": "Revenue", "series": [...], "type"?, "format"?, "x"? }]` renders a tab
  strip (ChatGPT-style "Revenue / Orders / Conversion") that switches the chart in place. When present it
  replaces the top-level `series`.

Limits: at most 12 series, 500 points per series. Invalid JSON or an unknown `type` renders the raw
block as code with a "Not a valid chart" note (never an empty card).

### Widget document

- A full HTML document with everything inline. No build step, no external files, no `fetch` to APIs that
  need keys. Scripts may be loaded from the same CDNs artifacts use (jsdelivr, unpkg, cdnjs, esm.sh).
- Opal injects, before the document's own `<head>` content:
  - the app's theme as CSS variables on `:root` (`--bg`, `--bg-elevated`, `--bg-muted`, `--bg-inset`,
    `--fg`, `--fg-secondary`, `--fg-muted`, `--fg-faint`, `--border`, `--accent`, `--success`,
    `--warning`, `--danger`) plus `color-scheme`, and a minimal base stylesheet (system font stack,
    `body { margin: 0; background: transparent; color: var(--fg) }`, sane `button`/`input`/`select`
    defaults). Widgets should use these variables so they match light and dark mode.
  - a bridge script that reports the content height (`ResizeObserver` on `document.documentElement` →
    `opal:resize`), runtime errors (`opal:error`), link clicks (`opal:open-url`) and exposes
    `window.opal.sendPrompt(text)` (→ `opal:prompt`: Opal sends `text` to the conversation as the
    user's next message, like a suggestion chip).
- Height follows the content, clamped between 80px and 640px (internal scroll beyond that). The
  document's own `<html>`/`<body>` height must not be forced to `100vh`.
- Sandbox: `allow-scripts allow-forms allow-pointer-lock` on an opaque origin — never
  `allow-same-origin`, never top navigation or popups. Links open in the system browser via
  `opal:open-url`.

### When to use which

- **Inline chart**: numbers discussed in the reply (a trend, a comparison, a breakdown).
- **Inline widget**: a small interactive explainer the user plays with while reading — a calculator with
  sliders, a what-if simulator, a decision tree, a step-through diagram, a mini table with filters. Keep
  it to roughly 150 lines; if it grows into an app, make an artifact instead.
- **Artifact**: a deliverable (dashboard, app, document, game) the user will keep, export, or iterate on
  over several turns.

## 2. Rendering (how Opal draws them)

````
assistant text part (Markdown)
  → react-markdown `pre` renderer sees language chart|widget|mermaid|svg
  → <InlineBlock> picks the renderer; the fence is "open" while streaming and its closing ``` has not
    arrived yet → shimmer placeholder ("Drawing chart…"), no partial render
  → chart   <InlineChart>  native Recharts, lazily imported (React.lazy), memoised on the block text
  → widget  <WidgetFrame>  iframe to the widget shell over the artifact bridge:
              app     artifact://localhost/_runtime/widget.html?bridge=1&theme=<light|dark>
              browser /artifact-runtime/widget.html?bridge=1&theme=<light|dark>
            shell posts opal:ready → parent posts {type:"opal:files", id, entry:"index.html", files}
            shell injects theme + bridge, document.write()s the page, posts opal:resize/opal:rendered
  → mermaid <WidgetFrame> with a generated document that loads Mermaid from the CDN (same shell)
  → svg     <InlineSvg> sanitised: shown as <img src="data:image/svg+xml,…"> (scripts never run)
````

- A widget's document is **never** placed in the app origin (no `srcdoc`, no `blob:` — both inherit
  the app's CSP and origin rules; the shell runs on the `artifact:` scheme / Vite origin without
  `allow-same-origin`). The sandbox tokens come from `sandboxFor(transport)` in `src/lib/artifacts/url.ts`.
- The iframe mounts once per block text (keyed by a content hash) so later streaming of the same message
  does not reload it. Re-rendering with identical text is a no-op.
- Each card has a small header (title, kind badge) and a footer action row: **Source** (toggle the raw
  fence as a code block, with copy) and, for `widget`/`chart`, **Open in panel** is _not_ offered —
  widgets are deliberately lightweight. Errors from the frame show the same banner as artifacts, with
  "Ask Opal to fix" (`runtime.sendPrompt`).
- `opal:prompt` from a widget is rate-limited (one per second) and the text is shown in the composer
  before sending only if it is longer than 200 characters; otherwise it is sent directly as a user
  message to the current session.
- Theme: `WidgetFrame` reloads the frame with the new `theme=` query when the app theme changes.

### Implementation notes

Code: `src/features/chat/inline/` (`fence.ts`, `chart-spec.ts`, `InlineBlock.tsx`, `InlineChart.tsx`,
`WidgetFrame.tsx`, `InlineMermaid.tsx` + `mermaid-doc.ts`, `InlineSvg.tsx`, `actions.ts`, `inline.css`),
the shell `public/artifact-runtime/widget.html`, and `Markdown.tsx` (`pre` renderer). Where it differs
from or refines the text above:

- The shell measures height on a microtask plus a 750 ms poll, never `requestAnimationFrame`: Chromium
  pauses rendering (and rAF) for cross-origin iframes outside the viewport, so a diagram that finished
  loading while scrolled away never reported its height.
- **Sandbox**: the frame uses `WIDGET_SANDBOX` (`allow-scripts allow-forms allow-pointer-lock`) from
  `src/lib/artifacts/url.ts`, not `sandboxFor(transport)`: `sandboxFor("bridge")` also grants popups,
  modals and downloads, which §1 rules out, and `sandboxFor("protocol")` adds `allow-same-origin`. The
  shell URL comes from `widgetShellURL(theme)` (bridge mode in both the app and the browser).
- **Open fences**: `Markdown` computes `openFenceOffset(text)` (CommonMark fence rules) while
  `streaming`; the `pre` whose source position starts at or after that offset is the unclosed one. A
  fence left unclosed when streaming ends is rendered (and fails validation like any other bad block).
- **No remount when streaming ends**: `Markdown` now uses one static `components` object and passes
  `streaming`/`sessionID`/the open-fence offset through a React context (previously it swapped two
  component sets, which remounts every block). `Markdown` gained an optional `sessionID` prop.
- **Shell**: besides the theme variables and base stylesheet, the shell sets `data-theme` on the
  written `<html>` and exposes `window.opal.theme`. `error-bridge.js` is loaded first; if it cannot load,
  an equivalent inline handler still reports `opal:error`/`opal:rendered`. Every http(s)/mailto link
  click goes out through `opal:open-url` (not only cross-origin ones).
- **Height**: initial height 160px (200px for Mermaid) behind a skeleton until the first
  `opal:resize`; the last height is kept across theme reloads so the card does not collapse.
- **Prompts**: `opal:prompt` is limited to one per second per frame (extra calls are dropped). Text
  longer than 200 characters is put in the session's composer draft (`useDrafts`, key = session id)
  instead of being sent. Messages are capped at 8 000 characters.
- **Errors**: the error banner sits below the frame inside the card (an overlay would cover small
  widgets) and adds **Reload** next to **Details** and **Ask Opal to fix**.
- **Source**: shows the fence _body_ (not the backtick lines) highlighted as json/html/mermaid/xml.
- **Header**: when a block has no title the header shows only the kind badge.
- **Chart spec**: an unknown `format` or `type` is an error (raw block + "Not a valid chart: …").
  `x` is optional (categories 1…n). A series shorter than `x` is padded with gaps; a longer one is an
  error. Pie/donut also accept plain numbers labelled by `x`; only the first series is used. At most 8
  datasets. `color` must look like a CSS color (hex, name, `rgb()/hsl()/oklch()/var()`).
- **Chart rendering**: the value axis uses round ticks (steps of 1/2/2.5/5 × 10ⁿ, compact labels from
  1 000); bars and areas start at zero, lines zoom to the data unless `yMin`/`yMax` are set. Legend
  entries (shown for ≥ 2 series/slices) are buttons that hide/show a series. A screen-reader table
  mirrors the data. Palette: `--chart-1…12` in `inline.css` (validated categorical order, separate dark
  steps), resolved to concrete colors per theme.
- **Mermaid**: Mermaid 11.12.2 (same as `mermaid.html`) with `theme: "base"` and theme variables taken
  from the injected Opal tokens, so diagrams match the card in both themes.
- **SVG**: missing `xmlns`/`xmlns:xlink` declarations are added; DOCTYPE/ENTITY declarations are
  rejected; `<script>`, `<foreignObject>`, `iframe/embed/object/audio/video/canvas`, `on*` attributes,
  non-fragment `href`s (except embedded raster `data:` images) and external `url()`/`@import` in styles
  are removed. An SVG with a pixel `width` is shown at that size, otherwise it fills the card width.

## 3. Mock runtime

`VITE_OPAL_MOCK=1`: a prompt containing "inline" (for example "show me your inline chat features")
replies with a scripted tour — one `chart` with dataset tabs, one `widget` calculator with sliders, one
`widget` decision tree, one `mermaid` diagram and one `svg` — so the renderers can be exercised without
a model.
