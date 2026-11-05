# Providers and models

Opal ships no models of its own. Every model comes from a provider you configure in
**Settings → Models & providers**. Opal writes those providers into the OpenCode config it
generates for its sidecar server (`buildOpenCodeConfig` in `src/lib/config/build.ts`).

## How a provider becomes available (OpenCode 2.2.5, verified in source)

- Every provider written to the config's `providers` map gets `activation = "enabled"`
  (core `config/plugin/provider.ts`, `overlayProvider`). An enabled provider is always
  listed and usable; it does not depend on catalog or env-var detection.
- The same plugin registers an integration for each configured provider with a
  "Manually enter API Key" method, whose `integrationID` is the provider id. A stored
  credential of type `key` is turned into the provider's `apiKey` at request time.
- With no credential and no `settings.apiKey`, an enabled provider runs with no auth.
  That is correct for Ollama and LM Studio.
- Providers you switch **off** in Opal are not written to `providers`. Opal adds a
  `policies` entry instead, `{ action: "provider.use", resource: "<id>", effect: "deny" }`,
  so catalog or env-var credentials can't keep the provider active behind your back.
- Package mapping: `@ai-sdk/*` packages are rewritten to OpenCode's native providers.
  Ids that match a models.dev catalog id inherit catalog metadata, and some get special
  native hosts: `zai`, `zhipuai`, `deepseek`, `moonshotai`, `alibaba`. That is why Opal's
  preset ids match the catalog ids.

## Where API keys are stored

- **Default (credential mode):** the key goes to the OpenCode credential store through
  the runtime: `credential.create({ integrationID: <provider id>, value: { type: "key", key } })`.
  It is never written to `opencode.json` or to Opal's `settings.json`.
- **File mode (opt-in):** `buildOpenCodeConfig(input, { apiKeyStorage: "file" })` writes
  `settings.apiKey` into the generated config. Use this only when you accept a plaintext key
  on disk.
- The UI never shows a stored key. Typed keys are masked as `••••` plus the last 4
  characters, and the form only sends a key when you type a new one.

## Adding Z.AI GLM-5.3, step by step

1. Get a key at https://z.ai/manage-apikey/apikey-list.
2. Open **Settings** (⌘,) → **Models & providers** → **Add provider** → **Z.AI**.
3. The form is prefilled:
   - name: Z.AI
   - id: `zai`
   - type: OpenAI-compatible
   - endpoint: `https://api.z.ai/api/paas/v4`
   - suggested models, including `glm-5.3`
4. Paste your API key. It stays masked.
5. Click **Fetch models** to pull the live list from `GET {endpoint}/models`. Your edits to
   existing rows are kept and new models are appended. Adjust context and max-output if
   needed. The preset's GLM-5.3 limits (1M context, 32,768 output) are unverified, so check
   them against Z.AI's documentation.
6. Click **Test connection**. You should see "Connected · N ms".
7. **Save**. Then set GLM-5.3 as the default in **Settings → General → Default model**,
   or pick it per chat in the model selector.

Use the **Zhipu** preset (`zhipuai`, open.bigmodel.cn) for the mainland-China endpoint.

Generated config (prompts abbreviated):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "zai/glm-5.3",
  "default_agent": "artifact",
  "providers": {
    "zai": {
      "name": "Z.AI",
      "package": "@ai-sdk/openai-compatible",
      "settings": { "baseURL": "https://api.z.ai/api/paas/v4" },
      "models": {
        "glm-5.3": {
          "name": "GLM-5.3",
          "limit": { "context": 1000000, "output": 32768 },
          "capabilities": { "tools": true, "input": ["text"], "output": ["text"], "reasoning": { "supported": true } }
        }
      }
    }
  },
  "agents": { "artifact": { "system": "…", "mode": "primary", "color": "#D97757" } },
  "experimental": { "artifacts": true, "subagent_depth": 1 },
  "share": "disabled",
  "update": "disable"
}
```

Note there is no `apiKey`: the key lives in the credential store.

## Ollama

1. Install Ollama, then run `ollama serve` and `ollama pull qwen3:8b` (or any model).
2. **Add provider → Ollama**. The endpoint defaults to `http://127.0.0.1:11434/v1`.
   No key is needed.
3. **Fetch models** reads `http://127.0.0.1:11434/api/tags` (the server root, not `/v1`).
   If it fails, Opal tells you to start `ollama serve`.
4. Pick models with tool-calling support. OpenCode's agent modes depend on tools.

## LM Studio

1. In LM Studio, open **Developer → Start server** (default port 1234) and load a model.
2. **Add provider → LM Studio**. The endpoint defaults to `http://127.0.0.1:1234/v1`.
3. **Fetch models** tries `/api/v0/models` first, which includes model type and max
   context, then falls back to `/v1/models`. Embedding models are skipped.

## OpenRouter

1. Create a key at https://openrouter.ai/settings/keys.
2. **Add provider → OpenRouter**. The endpoint is `https://openrouter.ai/api/v1`, and the
   package is `@openrouter/ai-sdk-provider`.
3. **Fetch models** returns OpenRouter's catalog, with context length, max completion
   tokens, vision and tool support. Disable or remove what you don't want. The list is long.
4. Optional headers for attribution, such as `HTTP-Referer` and `X-Title`, go in the
   **Headers** section.

## Importing from the OpenCode CLI

**Models & providers → Import from OpenCode CLI** reads `~/.config/opencode/opencode.json`
(`parseOpenCodeCliConfig` in `src/lib/config/cli-import.ts`).

- Both the v1 `provider` map (`npm`, `options.baseURL`, `options.apiKey`) and the v2
  `providers` map (`package`, `settings`) are understood.
- The `aisdk:` prefix is stripped and packages are mapped to Opal types. Unknown packages
  become **Custom**.
- Ids are sanitized and de-duplicated against your existing providers (`-2`, `-3`, …).
- A literal key in the CLI file is handed to the credential store and is **never** copied
  into Opal's settings. `{env:…}` and `{file:…}` references are skipped; enter the key
  manually.

## Custom providers

Choose **Custom** for any OpenAI-compatible endpoint, such as vLLM, llama.cpp server,
LiteLLM, or a company gateway. Enter the base URL that ends before `/chat/completions`
(usually `…/v1`). Add any extra headers, then fetch or type models.

## Chat Completions or Responses API

OpenAI-compatible and Custom providers have an **API** setting: **Chat Completions**
(`/chat/completions`, the default) or **Responses** (`/responses`). The **API** column in the
models table switches a single model; a highlighted value overrides the provider.

Use Responses when a model fails with an error like _"Function tools with reasoning_effort are
not supported … in /v1/chat/completions. To use function tools, use /v1/responses"_. OpenAI
reasoning models behind relays do this: with a thinking effort selected they accept tool calls
only on `/responses`, and Opal always sends tools.

- When fetching models, Opal sets Responses for models that a relay (new-api, one-api) lists
  under the `openai-response` endpoint only. Models that list both endpoints keep the
  provider's setting.
- Responses needs an API key; OpenCode refuses to call it without one. Ollama and LM Studio don't
  offer the setting because they are usually keyless.
- Code (`build.ts`): Responses maps to OpenCode's native package
  `@opencode/ai/providers/openai-compatible/responses`, set on the provider or on a single model
  (`Config.Model.package`). `tests/integration/responses-api.test.ts` checks against the real
  binary that such a model is called on `/responses` with its tools.

## Image fallback

Some chat models (GLM-5.3, most local models) cannot take image input. When you drop an image
into a chat that uses one of these models, Opal does not send the image to it. The image is
saved in the conversation's `uploads/` folder as usual, and the prompt tells the model to call
OpenCode's `subagent` tool with `agent: "vision"`. That helper is a read-only subagent pinned
to an image-capable model. It opens the image with the `read` tool and answers in text, for
example with a description or a transcription of the text in the image.

- **Settings → General → Image fallback** turns the feature on or off and chooses the model.
  When none is set, Opal picks a vision model from the live catalog. It prefers one from your
  default model's provider. The model must accept images and support tool calls.
- A model counts as image-capable when its capabilities list `image` input. For custom
  providers that is the **Vision** checkbox in the models table.
- The composer shows a note under attached images when the current model can't see them.
- Code (`src/lib/config/vision.ts`, `build.ts` `visionAgentEntry`): the vision agent is written
  to `opencode.json` only when a fallback model is set and its provider is enabled. It can read
  any conversation's `uploads/` folder. Reads elsewhere outside the session folder still ask
  first, and edit and shell are denied.
- LIMITATION: the plain-browser build has no saved upload path, so it still sends images inline.

## Troubleshooting

- **"Couldn't reach …"**: in the desktop app, model discovery goes through Opal's Rust core
  (`cmd_http_get`), so the provider's CORS policy does not matter; the URL is wrong, the server is
  down, or it needs a key for `/models`. Only the plain-browser dev build is subject to CORS. You
  can always type the model ids manually. Chat itself goes through the OpenCode server.
- **401/403**: the key was rejected. Re-enter it.
- **Provider missing from the selector**: check that it is switched on, and that at least
  one model is enabled and of type chat.
