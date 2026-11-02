import { describe, expect, it, vi } from "vitest"
import { connectPty, type PtyStatus } from "@/lib/runtime/code"

class FakeSocket {
  static all: FakeSocket[] = []
  binaryType = "blob"
  readyState = 0
  sent: unknown[] = []
  onopen: (() => void) | null = null
  onmessage: ((e: { data: unknown }) => void) | null = null
  onclose: ((e: { code: number }) => void) | null = null
  onerror: (() => void) | null = null
  constructor(public url: string) {
    FakeSocket.all.push(this)
  }
  send(data: unknown) {
    this.sent.push(data)
  }
  close() {
    this.readyState = 3
  }
  open() {
    this.readyState = 1
    this.onopen?.()
  }
  text(data: string) {
    this.onmessage?.({ data })
  }
  meta(cursor: number) {
    const json = new TextEncoder().encode(JSON.stringify({ cursor }))
    const frame = new Uint8Array(json.length + 1)
    frame.set(json, 1)
    this.onmessage?.({ data: frame.buffer })
  }
  drop(code: number) {
    this.readyState = 3
    this.onclose?.({ code })
  }
}

function setup(exited = false) {
  FakeSocket.all = []
  const data: string[] = []
  const status: PtyStatus[] = []
  const token = vi.fn(async () => "ticket-1")
  const conn = connectPty(
    { onData: (d) => data.push(d), onStatus: (s) => status.push(s) },
    {
      token,
      url: (ticket, cursor) =>
        `ws://h/pty?ticket=${ticket}${cursor !== undefined ? `&cursor=${cursor}` : ""}`,
      exited: async () => exited,
      WebSocket: FakeSocket as unknown as typeof WebSocket,
    },
  )
  return { conn, data, status, token }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe("connectPty", () => {
  it("connects with a ticket, streams output and sends input", async () => {
    const { conn, data, status, token } = setup()
    await flush()
    expect(token).toHaveBeenCalledOnce()
    const ws = FakeSocket.all[0]
    expect(ws.url).toBe("ws://h/pty?ticket=ticket-1")
    ws.open()
    ws.meta(0)
    ws.text("hello ")
    ws.text("world")
    expect(data.join("")).toBe("hello world")
    expect(status).toEqual(["connecting", "open"])
    conn.send("ls\r")
    expect(ws.sent).toEqual(["ls\r"])
    conn.close()
  })

  it("reconnects from the last cursor after an unexpected drop", async () => {
    vi.useFakeTimers()
    try {
      const { conn, status } = setup()
      await vi.advanceTimersByTimeAsync(0)
      const ws = FakeSocket.all[0]
      ws.open()
      ws.meta(5)
      ws.text("abc")
      ws.drop(1006)
      await vi.advanceTimersByTimeAsync(0)
      expect(status.at(-1)).toBe("closed")
      await vi.advanceTimersByTimeAsync(300)
      expect(status.at(-1)).toBe("connecting")
      expect(FakeSocket.all).toHaveLength(2)
      expect(FakeSocket.all[1].url).toContain("cursor=8")
      conn.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it("reports exited when the server says the PTY is gone", async () => {
    const { status } = setup()
    await flush()
    FakeSocket.all[0].open()
    FakeSocket.all[0].drop(4404)
    await flush()
    expect(status.at(-1)).toBe("exited")
    expect(FakeSocket.all).toHaveLength(1)
  })

  it("reports exited when the process ended even on an abnormal close", async () => {
    const { status } = setup(true)
    await flush()
    FakeSocket.all[0].open()
    FakeSocket.all[0].drop(1006)
    await flush()
    await flush()
    expect(status.at(-1)).toBe("exited")
  })
})
