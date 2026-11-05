# Changelog

All notable changes to Opal are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). See docs/RELEASING.md for the release process.

## [Unreleased]

## [0.1.3] — 2026-11-05

### Added

- **Responses API for OpenAI-compatible providers**: choose Chat Completions or Responses per
  provider, and switch single models in the models table. This fixes models that fail with
  "Function tools with reasoning_effort are not supported … in /v1/chat/completions" (OpenAI
  reasoning models behind relays). When fetching models from a relay, models it serves only
  through its Responses endpoint are set to Responses automatically. Responses needs an API key.

## [0.1.2] — 2026-11-05

### Added

- **Image fallback**: images dropped into a chat whose model can't see images are now handed to a
  read-only "vision" helper running on an image-capable model, which looks at them and answers in
  text. Turn it on or off and pick the model under Settings › General › Image fallback; by default
  Opal picks a vision model from your configured providers. The composer shows a note when
  attached images will go to the fallback model.

## [0.1.1] — 2026-11-05

### Fixed

- Long conversations (more than 200 messages) no longer open empty after restarting Opal.
- Esc reliably stops a running reply, even when the live event stream has stalled, and inline
  cards no longer swallow the key.
- Tables in replies size their columns to the content instead of squeezing short columns down to
  one letter per line; wide tables scroll sideways.

### Changed

- Model discovery for relay providers (new-api, one-api) hides image, video and other task models
  that can't answer chat requests, and "Test connection" now tests a chat-capable model.

## [0.1.0] — 2026-11-02

First public release.

### Added

- **Chat** with streaming Markdown, formatted reasoning, tool calls, rotating status verbs, Projects
  with instructions and knowledge files, starred and recent conversations, and search.
- **Inline widgets**: the model can render interactive charts (`chart`), sandboxed HTML widgets
  (`widget`), Mermaid diagrams and SVG directly inside a reply.
- **Artifacts**: HTML, React, Markdown, Mermaid, SVG, CSV, JSON and code artifacts rendered live in a
  side panel on an isolated `artifact://` origin, with version history, export and "Ask Opal to fix".
- **Per-conversation workspaces**: every chat owns a folder; dropped files land in `uploads/` and the
  agent can read, process and produce files there.
- **Code surface**: per-repository sessions, optional git worktrees, diff viewer, integrated terminal,
  subagents and inline permission prompts.
- **Any provider**: OpenAI-compatible endpoints, Ollama, LM Studio, OpenRouter, Anthropic, OpenAI and
  custom packages, with model discovery, per-model thinking effort and a concurrency limit.
- **Agent modes** with dedicated system prompts: Artifacts, Code, General and Research; prompts are
  editable in Settings.
- **Sandboxing**: shell commands run through a macOS `sandbox-exec` profile (filesystem or strict
  mode) that scrubs engine credentials, hides the engine's data and blocks its local ports.
- **Remote control**: continue a session from a phone or another computer over a paired link.
- **Over-the-air updates**: signed update bundles checked on launch and from Opal › Check for
  Updates…, published through GitHub Releases.
- **Native macOS app**: menu bar, overlay title bar with inset traffic lights, light and dark
  appearance, Developer ID signing, notarized DMG.
- Bundled **OpenCode 2.2.5** sidecar with isolated data directories.
