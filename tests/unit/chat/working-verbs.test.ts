import { WORKING_VERBS, pickVerb, verbLabel } from "@/features/chat/working-verbs"

describe("working verbs", () => {
  it("includes the requested silly ones", () => {
    expect(WORKING_VERBS).toEqual(expect.arrayContaining(["Thinking", "Opaling", "67ing"]))
  })
  it("never repeats the previous verb", () => {
    for (let i = 0; i < 50; i++) expect(pickVerb("Opaling", () => i / 50)).not.toBe("Opaling")
  })
  it("formats with an ellipsis", () => {
    expect(verbLabel("Pondering")).toBe("Pondering…")
  })
})
