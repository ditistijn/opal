import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { runtime } from "@/lib/runtime"
import { ModelSelector } from "@/features/models/ModelSelector"
import { model, provider, type StubRuntime } from "./stub-runtime"

vi.mock("@/lib/runtime", async () => {
  const { makeStubRuntime } = await import("./stub-runtime")
  return { runtime: makeStubRuntime() }
})

const stub = runtime as unknown as StubRuntime

beforeEach(() => {
  stub.setState({
    providers: [provider("zai", "Z.AI"), provider("ollama", "Ollama")],
    models: [
      model("zai", "glm-5.3", "GLM-5.3", { limit: { context: 1_000_000, output: 32_768 }, variants: [{ id: "high" }] }),
      model("zai", "glm-4.5v", "GLM-4.5V", { capabilities: { tools: true, input: ["text", "image"], output: ["text"] } }),
      model("ollama", "qwen3:8b", "qwen3:8b"),
      model("zai", "embedding-3", "Embedding 3", { type: "embedding" }),
      model("zai", "old", "Old", { enabled: false }),
    ],
    sessions: { ses_1: { id: "ses_1", model: { providerID: "zai", id: "glm-5.3" } } as never },
  })
  vi.clearAllMocks()
})

describe("ModelSelector", () => {
  it("shows the current model with its provider", () => {
    render(<ModelSelector value={{ providerID: "zai", id: "glm-5.3" }} />)
    const trigger = screen.getByRole("button", { name: "Model: GLM-5.3" })
    expect(trigger).toHaveTextContent("GLM-5.3")
    expect(trigger).toHaveTextContent("Z.AI")
  })

  it("hides the provider name in compact mode", () => {
    render(<ModelSelector compact value={{ providerID: "zai", id: "glm-5.3" }} />)
    expect(screen.getByRole("button", { name: "Model: GLM-5.3" })).not.toHaveTextContent("Z.AI")
  })

  it("groups live chat models by provider with context and capabilities", async () => {
    const user = userEvent.setup()
    render(<ModelSelector value={{ providerID: "zai", id: "glm-5.3" }} />)
    await user.click(screen.getByRole("button", { name: "Model: GLM-5.3" }))
    const listbox = screen.getByRole("listbox", { name: "Models" })
    const groups = within(listbox).getAllByRole("group")
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual(["Ollama", "Z.AI"])
    const options = within(listbox).getAllByRole("option")
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining("qwen3:8b"),
      expect.stringContaining("GLM-4.5V"),
      expect.stringContaining("GLM-5.3"),
    ])
    expect(screen.queryByText("Embedding 3")).toBeNull()
    expect(screen.queryByText("Old")).toBeNull()
    const glm = options[2]
    expect(glm).toHaveAttribute("aria-selected", "true")
    expect(glm).toHaveTextContent("1M context")
    expect(within(glm).getByLabelText("Reasoning")).toBeInTheDocument()
    expect(within(options[1]).getByLabelText("Vision")).toBeInTheDocument()
    expect(screen.queryByRole("textbox", { name: "Search models" })).toBeNull()
  })

  it("calls onChange when no session is given", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ModelSelector onChange={onChange} />)
    await user.click(screen.getByRole("button", { name: "Select model" }))
    await user.click(screen.getByRole("option", { name: /qwen3:8b/ }))
    expect(onChange).toHaveBeenCalledWith({ providerID: "ollama", id: "qwen3:8b" })
    expect(stub.setSessionModel).not.toHaveBeenCalled()
  })

  it("switches the session model when sessionID is given", async () => {
    const user = userEvent.setup()
    render(<ModelSelector sessionID="ses_1" />)
    await user.click(screen.getByRole("button", { name: "Model: GLM-5.3" }))
    await user.click(screen.getByRole("option", { name: /GLM-4.5V/ }))
    expect(stub.setSessionModel).toHaveBeenCalledWith("ses_1", { providerID: "zai", id: "glm-4.5v" })
    expect(await screen.findByRole("button", { name: "Model: GLM-4.5V" })).toBeInTheDocument()
  })

  it("is keyboard navigable", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ModelSelector value={{ providerID: "ollama", id: "qwen3:8b" }} onChange={onChange} />)
    await user.click(screen.getByRole("button", { name: "Model: qwen3:8b" }))
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}")
    expect(onChange).toHaveBeenCalledWith({ providerID: "zai", id: "glm-5.3" })
  })

  it("shows a search field for long lists and filters", async () => {
    stub.setState({
      models: Array.from({ length: 12 }, (_, i) => model("zai", `glm-${i}`, `GLM ${i}`)).concat(model("ollama", "llama3", "Llama 3")),
    })
    const user = userEvent.setup()
    render(<ModelSelector />)
    await user.click(screen.getByRole("button", { name: "Select model" }))
    const search = screen.getByRole("textbox", { name: "Search models" })
    await user.type(search, "llama")
    expect(screen.getAllByRole("option")).toHaveLength(1)
    await user.keyboard("{Enter}")
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  it("shows an empty state", async () => {
    stub.setState({ models: [] })
    const user = userEvent.setup()
    render(<ModelSelector />)
    await user.click(screen.getByRole("button", { name: "Select model" }))
    expect(screen.getByText(/No models available yet/)).toBeInTheDocument()
  })

  it("Manage models… delegates when a handler is given", async () => {
    const user = userEvent.setup()
    const onManage = vi.fn()
    render(<ModelSelector onManageModels={onManage} />)
    await user.click(screen.getByRole("button", { name: "Select model" }))
    await act(async () => {
      await user.click(screen.getByRole("button", { name: "Manage models…" }))
    })
    expect(onManage).toHaveBeenCalled()
  })
})
