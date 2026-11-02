/**
 * Remote-control pairing links for the Opal web UI (served to phones by src-tauri/src/remote_web.rs).
 *
 * Link: `http://<mac>:<webPort>/#rc=<base64url JSON {url, code, conversations?}>`. The fragment never reaches a
 * server. On load the web build redeems the one-time code itself — `GET <url>/auth/connect/<code>` with
 * `Accept: application/json` returns `{token}` (OpenCode server/src/handlers/server.ts), a 30-day session token
 * accepted as the Basic-auth password — stores `{url, password: token}` in localStorage (`opal.server.*`) and
 * strips the fragment. The server password itself never leaves the Mac.
 */
export interface RemotePayload {
  /** Sidecar base URL reachable from the device, e.g. http://192.168.1.20:47801 */
  url: string
  /** One-time pairing code (5 minutes). */
  code: string
  /** Opal's conversations folder on the Mac, so chats started on the device get their own sandbox folder. */
  conversations?: string
}

export const REMOTE_KEYS = {
  url: "opal.server.url",
  password: "opal.server.password",
  conversations: "opal.remote.conversations",
  paired: "opal.remote.paired",
} as const

function toBase64Url(text: string) {
  const bytes = new TextEncoder().encode(text)
  let binary = ""
  bytes.forEach((b) => (binary += String.fromCharCode(b)))
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function fromBase64Url(value: string) {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/")
  const binary = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4))
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))
}

export function encodeRemotePayload(payload: RemotePayload): string {
  return toBase64Url(JSON.stringify(payload))
}

/** Parses `#rc=…` (or a bare payload); undefined when absent or malformed. */
export function decodeRemotePayload(hash: string): RemotePayload | undefined {
  const match = /(?:^#?|&)rc=([A-Za-z0-9_-]+)/.exec(hash)
  if (!match) return undefined
  try {
    const value = JSON.parse(fromBase64Url(match[1]!)) as Partial<RemotePayload>
    if (typeof value.url !== "string" || typeof value.code !== "string") return undefined
    const url = new URL(value.url)
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
    return {
      url: url.origin,
      code: value.code,
      ...(typeof value.conversations === "string" ? { conversations: value.conversations } : {}),
    }
  } catch {
    return undefined
  }
}

/**
 * The engine runs on the same Mac that serves the web UI, so the device reaches it through the host it loaded
 * the page from (LAN IP, `<name>.local`, a Tailscale address or `localhost` via SSH forwarding) and the port from
 * the payload.
 */
export function engineURLFor(payloadURL: string, pageHostname: string | undefined): string {
  const url = new URL(payloadURL)
  if (pageHostname) url.hostname = pageHostname
  return url.origin
}

export function pairingLinks(input: {
  webURL: string
  sidecarURL: string
  code: string
  conversations?: string
}) {
  const payload = encodeRemotePayload({
    url: input.sidecarURL,
    code: input.code,
    conversations: input.conversations,
  })
  return {
    link: `${input.webURL.replace(/\/$/, "")}/#rc=${payload}`,
    openCodeLink: `${input.sidecarURL.replace(/\/$/, "")}/auth/connect/${encodeURIComponent(input.code)}`,
  }
}

/** Exchanges a pairing code for a session token. */
export async function redeemPairing(payload: RemotePayload, fetcher: typeof fetch = fetch): Promise<string> {
  const res = await fetcher(`${payload.url}/auth/connect/${encodeURIComponent(payload.code)}`, {
    headers: { Accept: "application/json" },
  })
  if (!res.ok)
    throw new Error(
      res.status === 401 ? "This pairing link expired or was already used." : `HTTP ${res.status}`,
    )
  const body = (await res.json()) as { token?: unknown }
  if (typeof body.token !== "string" || !body.token)
    throw new Error("The server did not return a session token.")
  return body.token
}

/**
 * Browser build: if the page was opened from a pairing link, redeem it and remember the connection.
 * Returns an error message when a link was present but could not be redeemed.
 */
export async function consumePairingLink(): Promise<string | undefined> {
  if (typeof window === "undefined") return undefined
  const payload = decodeRemotePayload(window.location.hash)
  if (!payload) return undefined
  // Strip the fragment first so a reload never retries a spent code.
  history.replaceState(null, "", window.location.pathname + window.location.search)
  try {
    const url = engineURLFor(
      payload.url,
      window.location.protocol.startsWith("http") ? window.location.hostname : undefined,
    )
    const token = await redeemPairing({ ...payload, url })
    localStorage.setItem(REMOTE_KEYS.url, url)
    localStorage.setItem(REMOTE_KEYS.password, token)
    localStorage.setItem(REMOTE_KEYS.paired, String(Date.now()))
    if (payload.conversations) localStorage.setItem(REMOTE_KEYS.conversations, payload.conversations)
    else localStorage.removeItem(REMOTE_KEYS.conversations)
    return undefined
  } catch (error) {
    return `Pairing failed: ${error instanceof Error ? error.message : String(error)} Create a new link in Opal on your Mac (Settings → Remote control).`
  }
}

/** The Mac's conversations folder recorded at pairing time (remote devices only). */
export function remoteConversationsDir(): string | undefined {
  try {
    return localStorage.getItem(REMOTE_KEYS.conversations) ?? undefined
  } catch {
    return undefined
  }
}

export function isPairedDevice(): boolean {
  try {
    return localStorage.getItem(REMOTE_KEYS.paired) !== null
  } catch {
    return false
  }
}
