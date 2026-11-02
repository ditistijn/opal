import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { runtime } from "@/lib/runtime"
import { SettingsDialog, resolveTab } from "@/features/settings/SettingsDialog"
import { DEFAULT_SETTINGS, type StubRuntime } from "./stub-runtime"

vi.mock("@/lib/runtime", async () => {
  const { makeStubRuntime } = await import("./stub-runtime")
  return { runtime: makeStubRuntime() }
})

const stub = runtime as unknown as StubRuntime

beforeEach(() => {
  stub.setState({ settings: { ...DEFAULT_SETTINGS, providers: [] }, providers: [], models: [] })
  vi.clearAllMocks()
})

describe("SettingsDialog", () => {
  it("resolves tab aliases", () => {
    expect(resolveTab("providers")).toBe("models")
    expect(resolveTab("prompts")).toBe("prompts")
    expect(resolveTab("nope")).toBe("general")
  })

  it("opens on the requested tab and navigates", async () => {
    const user = userEvent.setup()
    render(<SettingsDialog open onOpenChange={() => {}} initialTab="models" />)
    expect(screen.getByRole("heading", { name: "Models & providers" })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "General" }))
    expect(screen.getByRole("heading", { name: "General" })).toBeInTheDocument()
  })

  it("updates max concurrent connections within 1–16", async () => {
    const user = userEvent.setup()
    stub.setState({ settings: { ...DEFAULT_SETTINGS, maxConcurrentConnections: 16 } })
    render(<SettingsDialog open onOpenChange={() => {}} />)
    expect(screen.getByRole("button", { name: "Increase Max concurrent API connections" })).toBeDisabled()
    await user.click(screen.getByRole("button", { name: "Decrease Max concurrent API connections" }))
    expect(stub.updateSettings).toHaveBeenCalledWith({ maxConcurrentConnections: 15 })
  })

  it("adds a Z.AI provider from a preset without persisting the key in settings", async () => {
    const user = userEvent.setup()
    render(<SettingsDialog open onOpenChange={() => {}} initialTab="models" />)
    await user.click(screen.getAllByRole("button", { name: "Add provider" })[0])
    await user.click(screen.getByRole("button", { name: /^Z\.AI/ }))
    expect(screen.getByLabelText("Endpoint")).toHaveValue("https://api.z.ai/api/paas/v4")
    expect(screen.getByLabelText("Provider ID")).toHaveValue("zai")
    expect(screen.getByLabelText("Model 1 ID")).toHaveValue("glm-5.3")

    // Missing key → validation error, nothing saved.
    await user.click(screen.getByRole("button", { name: "Add provider" }))
    expect(screen.getByText("This provider needs an API key.")).toBeInTheDocument()
    expect(stub.saveProvider).not.toHaveBeenCalled()

    const key = screen.getByLabelText("API key")
    expect(key).toHaveAttribute("type", "password")
    await user.type(key, "sk-test-0000")
    await user.click(screen.getByRole("button", { name: "Show API key" }))
    expect(key).toHaveAttribute("type", "text")
    await user.click(screen.getByRole("button", { name: "Add provider" }))

    await waitFor(() => expect(stub.saveProvider).toHaveBeenCalledTimes(1))
    const saved = stub.saveProvider.mock.calls[0][0]
    expect(saved).toMatchObject({ id: "zai", name: "Z.AI", type: "openai-compatible", apiKey: "sk-test-0000", enabled: true })
    expect(stub.getState().settings.providers[0]).not.toHaveProperty("apiKey")

    const list = await screen.findByRole("list", { name: "Providers" })
    expect(within(list).getByText("Z.AI")).toBeInTheDocument()
    expect(within(list).getByText(/OpenAI-compatible · api\.z\.ai · 4 models/)).toBeInTheDocument()
  })

  it("tests a connection and shows latency inline", async () => {
    const user = userEvent.setup()
    stub.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        providers: [{ id: "zai", name: "Z.AI", type: "openai-compatible", baseURL: "https://api.z.ai/api/paas/v4", models: [{ id: "glm-5.3", name: "GLM-5.3" }], enabled: true }],
      },
    })
    render(<SettingsDialog open onOpenChange={() => {}} initialTab="models" />)
    await user.click(screen.getByRole("button", { name: "Edit Z.AI" }))
    await user.click(screen.getByRole("button", { name: "Test connection" }))
    expect(await screen.findByText("Connected · 231 ms")).toBeInTheDocument()
    expect(stub.testProvider).toHaveBeenCalledWith(expect.objectContaining({ id: "zai" }), "glm-5.3")
  })

  it("imports from the OpenCode CLI", async () => {
    const user = userEvent.setup()
    render(<SettingsDialog open onOpenChange={() => {}} initialTab="models" />)
    await user.click(screen.getByRole("button", { name: "Import from OpenCode CLI" }))
    expect(await screen.findByText(/Imported 1 provider/)).toBeInTheDocument()
  })

  it("customizes and resets a system prompt", async () => {
    const user = userEvent.setup()
    render(<SettingsDialog open onOpenChange={() => {}} initialTab="prompts" />)
    await user.click(screen.getByRole("tab", { name: "Research" }))
    expect(screen.getByLabelText("Research system prompt preview")).toHaveTextContent("Research mode")
    await user.click(screen.getByRole("button", { name: "Customize" }))
    const editor = screen.getByLabelText("Research system prompt")
    await user.clear(editor)
    await user.type(editor, "Be brief. {{{{builtin}}")
    await user.click(screen.getByRole("button", { name: "Save" }))
    expect(stub.setPromptOverride).toHaveBeenCalledWith("research", "Be brief. {{builtin}}")
    await user.click(await screen.findByRole("button", { name: "Reset to default" }))
    expect(stub.setPromptOverride).toHaveBeenLastCalledWith("research", undefined)
  })
})
