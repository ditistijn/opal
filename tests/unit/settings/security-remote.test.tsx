import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { remoteRuntime, runtime } from "@/lib/runtime"
import { SecurityPage } from "@/features/settings/pages/SecurityPage"
import { RemotePage } from "@/features/settings/pages/RemotePage"
import { DEFAULT_SETTINGS, type StubRuntime } from "./stub-runtime"

vi.mock("@/lib/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils")>()),
  isTauri: () => true,
}))

vi.mock("@/lib/runtime", async () => {
  const { makeStubRuntime } = await import("./stub-runtime")
  const status = {
    enabled: true,
    lan: true,
    lanIPs: ["192.168.1.20"],
    hostName: "Mac.local",
    webPort: 47800,
    sidecarPort: 47801,
    sidecarURL: "http://192.168.1.20:47801",
    webURL: "http://192.168.1.20:47800",
    webRunning: true,
    networkChanged: false,
  }
  return {
    runtime: makeStubRuntime(),
    sandboxRuntime: {
      useStatus: () => ({
        status: { available: true, mode: "filesystem", allow: [], shellPath: "/opal/bin/sandbox/zsh" },
      }),
    },
    remoteRuntime: {
      useStatus: () => ({ status, busy: false }),
      enable: vi.fn(async () => status),
      disable: vi.fn(async () => status),
      setLan: vi.fn(async () => status),
      revokeAll: vi.fn(async () => {}),
      pair: vi.fn(async () => ({
        code: "abc",
        expiresAt: Date.now() + 300_000,
        link: "http://192.168.1.20:47800/#rc=eyJ1cmwiOiJ4In0",
        openCodeLink: "http://192.168.1.20:47801/auth/connect/abc",
      })),
    },
  }
})

const stub = runtime as unknown as StubRuntime

beforeEach(() => {
  stub.setState({
    settings: {
      ...DEFAULT_SETTINGS,
      sandbox: { mode: "filesystem", allowPaths: ["/extra"] },
      remote: { enabled: true, lan: true },
    },
  })
  vi.clearAllMocks()
})

describe("SecurityPage", () => {
  it("shows the active sandbox and switches modes", async () => {
    const user = userEvent.setup()
    render(<SecurityPage />)
    expect(screen.getByRole("status")).toHaveTextContent("Sandbox active")
    expect(screen.getByRole("radio", { name: /Protect my files \(recommended\)/ })).toHaveAttribute(
      "aria-checked",
      "true",
    )
    await user.click(screen.getByRole("radio", { name: /Strict/ }))
    expect(runtime.updateSettings).toHaveBeenCalledWith({
      sandbox: { mode: "strict", allowPaths: ["/extra"] },
    })
  })

  it("removes an extra folder", async () => {
    const user = userEvent.setup()
    render(<SecurityPage />)
    await user.click(screen.getByRole("button", { name: "Remove /extra" }))
    expect(runtime.updateSettings).toHaveBeenCalledWith({ sandbox: { mode: "filesystem", allowPaths: [] } })
  })
})

describe("RemotePage", () => {
  it("pairs a device with a QR code, link and countdown", async () => {
    const user = userEvent.setup()
    render(<RemotePage />)
    expect(screen.getByText("http://192.168.1.20:47800")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Pair a device" }))
    await waitFor(() => expect(screen.getByRole("img", { name: "Pairing QR code" })).toBeInTheDocument())
    expect(screen.getByText("http://192.168.1.20:47800/#rc=eyJ1cmwiOiJ4In0")).toBeInTheDocument()
    expect(screen.getByText(/Expires in [45]:\d\d · works once/)).toBeInTheDocument()
    expect(remoteRuntime.pair).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole("button", { name: "Regenerate" }))
    expect(remoteRuntime.pair).toHaveBeenCalledTimes(2)
  })

  it("turns remote control off", async () => {
    const user = userEvent.setup()
    render(<RemotePage />)
    await user.click(screen.getByRole("switch", { name: "Allow other devices to connect" }))
    expect(remoteRuntime.disable).toHaveBeenCalled()
  })
})
