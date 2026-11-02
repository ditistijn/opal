/**
 * A fetch that goes through the Rust core (reqwest) inside Tauri, so provider endpoints that do not send CORS
 * headers can still be queried from Settings → "Fetch models". GET only. Outside Tauri it is the browser's fetch.
 */
import { isTauri } from "@/lib/utils"

interface HttpGetResult {
  status: number
  body: string
  content_type: string | null
}

export const nativeFetch: typeof fetch = async (input, init) => {
  if (!isTauri()) return fetch(input, init)
  const method = (init?.method ?? "GET").toUpperCase()
  if (method !== "GET") throw new Error(`nativeFetch supports GET only (got ${method})`)
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  const headers: Record<string, string> = {}
  new Headers(init?.headers).forEach((value, key) => {
    headers[key] = value
  })
  const { invoke } = await import("@tauri-apps/api/core")
  const result = await invoke<HttpGetResult>("cmd_http_get", { url, headers, timeoutMs: 15_000 })
  return new Response(result.body, {
    status: result.status,
    headers: result.content_type ? { "content-type": result.content_type } : undefined,
  })
}
