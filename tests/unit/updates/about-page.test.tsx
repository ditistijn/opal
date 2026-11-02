import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { runtime } from "@/lib/runtime"
import { useUpdates } from "@/lib/native/update-store"
import { AboutPage } from "@/features/settings/pages/AboutPage"
import { DEFAULT_SETTINGS, type StubRuntime } from "../settings/stub-runtime"

vi.mock("@/lib/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils")>()),
  isTauri: () => true,
}))
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "0.1.7" }))
vi.mock("@/lib/runtime", async () => {
  const { makeStubRuntime } = await import("../settings/stub-runtime")
  return { runtime: makeStubRuntime() }
})

const stub = runtime as unknown as StubRuntime
const check = vi.fn(async () => {})
const install = vi.fn(async () => {})

beforeEach(() => {
  stub.setState({ settings: DEFAULT_SETTINGS })
  vi.clearAllMocks()
  useUpdates.setState({
    status: "idle",
    progress: 0,
    available: undefined,
    error: undefined,
    lastChecked: undefined,
    check,
    install,
  })
})

describe("AboutPage updates", () => {
  it("shows the bundle version and a check row that triggers a non-silent check", async () => {
    const user = userEvent.setup()
    render(<AboutPage />)
    expect(await screen.findByText("Version 0.1.7")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Check for updates" }))
    expect(check).toHaveBeenCalledWith({ silent: false })
  })

  it("reflects checking, up to date and error states", () => {
    render(<AboutPage />)
    act(() => useUpdates.setState({ status: "checking" }))
    expect(screen.getByRole("button", { name: "Checking…" })).toBeDisabled()
    act(() => useUpdates.setState({ status: "none", lastChecked: Date.now() }))
    expect(screen.getByText(/You’re up to date/)).toBeInTheDocument()
    act(() => useUpdates.setState({ status: "error", error: "Could not reach GitHub" }))
    expect(screen.getByText("Could not reach GitHub")).toHaveClass("text-danger/80")
  })

  it("offers the available update with notes and shows download progress", async () => {
    const user = userEvent.setup()
    render(<AboutPage />)
    act(() =>
      useUpdates.setState({
        status: "available",
        available: { version: "0.2.0", notes: "## New\n- Faster chats" },
      }),
    )
    expect(screen.getByText("Opal 0.2.0 is available")).toBeInTheDocument()
    expect(screen.getByText("New Faster chats")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Update and restart" }))
    expect(install).toHaveBeenCalled()
    act(() => useUpdates.setState({ status: "downloading", progress: 0.42 }))
    expect(screen.getByRole("progressbar", { name: "Download progress" })).toHaveAttribute(
      "aria-valuenow",
      "42",
    )
    expect(screen.getByRole("button", { name: "Updating…" })).toBeDisabled()
  })

  it("toggles automatic update checks", async () => {
    const user = userEvent.setup()
    render(<AboutPage />)
    const toggle = screen.getByRole("switch", { name: "Automatically check for updates" })
    expect(toggle).toHaveAttribute("aria-checked", "true")
    await user.click(toggle)
    expect(runtime.updateSettings).toHaveBeenCalledWith({ updates: { autoCheck: false } })
  })
})
