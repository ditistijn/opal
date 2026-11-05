import { beforeEach, describe, expect, it, vi } from "vitest"
import { preparePrompt } from "@/lib/runtime/attachments"

vi.mock("@/lib/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils")>()),
  isTauri: () => true,
}))

const importUploads = vi.fn()
vi.mock("@/lib/runtime/native", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/runtime/native")>()),
  native: { importUploads: (...args: unknown[]) => importUploads(...args) },
}))

const DIR = "/opal/conversations/ses_1"

beforeEach(() => {
  importUploads.mockReset()
  importUploads.mockResolvedValue([
    { name: "uploads/shot.png", path: `${DIR}/uploads/shot.png`, size: 2048 },
    { name: "uploads/notes.txt", path: `${DIR}/uploads/notes.txt`, size: 10 },
  ])
})

const input = {
  text: "what's in this?",
  files: [
    { name: "shot.png", path: "/Users/me/Desktop/shot.png", mime: "image/png" },
    { name: "notes.txt", path: "/Users/me/Desktop/notes.txt" },
  ],
}

describe("preparePrompt image routing", () => {
  it("sends images as file parts to a model that sees images", async () => {
    const prepared = await preparePrompt(input, "ses_1", DIR, { imageInput: true })
    expect(prepared.files).toEqual([{ uri: `file://${DIR}/uploads/shot.png`, name: "shot.png" }])
    expect(prepared.text).not.toContain("cannot see images")
  })

  it("routes images to the vision helper when the model has no image input", async () => {
    const prepared = await preparePrompt(input, "ses_1", DIR, { imageInput: false, visionHelper: true })
    expect(prepared.files).toEqual([])
    expect(prepared.text).toContain("- uploads/shot.png (image/png, 2.0 KB)")
    expect(prepared.text).toContain('call the subagent tool with agent "vision"')
    // The UI still shows both chips, and the image chip survives a reload via metadata.
    expect(prepared.attachments.map((a) => a.name)).toEqual(["shot.png", "notes.txt"])
    expect(prepared.metadata.opal.attachments?.map((a) => a.name)).toEqual(["shot.png", "notes.txt"])
    expect(prepared.metadata.opal.text).toBe("what's in this?")
  })

  it("tells the model to explain itself when no helper is configured", async () => {
    const prepared = await preparePrompt(input, "ses_1", DIR, { imageInput: false, visionHelper: false })
    expect(prepared.files).toEqual([])
    expect(prepared.text).toContain("no image-capable helper is configured")
  })

  it("adds no helper note when no image was attached", async () => {
    importUploads.mockResolvedValue([
      { name: "uploads/notes.txt", path: `${DIR}/uploads/notes.txt`, size: 10 },
    ])
    const prepared = await preparePrompt(
      { text: "hi", files: [{ name: "notes.txt", path: "/x/notes.txt" }] },
      "ses_1",
      DIR,
      { imageInput: false, visionHelper: true },
    )
    expect(prepared.text).not.toContain("cannot see images")
  })
})
