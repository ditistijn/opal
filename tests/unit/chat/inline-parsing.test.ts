import { describe, expect, it } from "vitest"
import {
  formatAxisValue,
  formatValue,
  niceScale,
  MAX_POINTS,
  MAX_SERIES,
  parseChartSpec,
  validateChartSpec,
} from "@/features/chat/inline/chart-spec"
import {
  contentHash,
  isInlineKind,
  lastFenceOpen,
  openFenceOffset,
  parseInfoString,
  parseTitle,
} from "@/features/chat/inline/fence"
import { makeRateLimiter } from "@/features/chat/inline/actions"
import { parseArtifactMessage } from "@/lib/artifacts"
import { sanitizeSvg } from "@/features/chat/inline/InlineSvg"
import { clampFrameHeight } from "@/features/chat/inline/WidgetFrame"

describe("fence info strings", () => {
  it("parses the language and title", () => {
    expect(parseInfoString('widget title="Fleet simulator"')).toEqual({
      lang: "widget",
      title: "Fleet simulator",
    })
    expect(parseInfoString("Chart")).toEqual({ lang: "chart", title: undefined })
    expect(parseInfoString("")).toEqual({ lang: "" })
    expect(parseTitle("title='Single quoted'")).toBe("Single quoted")
    expect(parseTitle("title=Bare other=1")).toBe("Bare")
    expect(parseTitle('foo="x" title="Esc \\"q\\""')).toBe('Esc "q"')
    expect(parseTitle("subtitle=nope")).toBeUndefined()
    expect(parseTitle(undefined)).toBeUndefined()
  })

  it("knows the reserved languages", () => {
    for (const k of ["chart", "widget", "mermaid", "svg", "SVG"]) expect(isInlineKind(k)).toBe(true)
    for (const k of ["html", "json", "", undefined]) expect(isInlineKind(k)).toBe(false)
  })
})

describe("open fence detection", () => {
  it("finds an unclosed last fence", () => {
    const text = "Intro\n\n```widget\n<div>"
    expect(openFenceOffset(text)).toBe(7)
    expect(lastFenceOpen(text)).toBe(true)
  })

  it("treats closed fences as closed", () => {
    expect(lastFenceOpen("```chart\n{}\n```")).toBe(false)
    expect(lastFenceOpen("```chart\n{}\n```\n\nAfter")).toBe(false)
    expect(lastFenceOpen("no fences")).toBe(false)
  })

  it("follows CommonMark closing rules", () => {
    // a shorter or different fence does not close; a longer one does
    expect(lastFenceOpen("````widget\nx\n```")).toBe(true)
    expect(lastFenceOpen("```widget\nx\n~~~")).toBe(true)
    expect(lastFenceOpen("```widget\nx\n`````")).toBe(false)
    // closing fences cannot carry an info string
    expect(lastFenceOpen("```widget\nx\n```js")).toBe(true)
    // a second fence after a closed one
    expect(openFenceOffset("```a\n```\n```mermaid\ngraph")).toBe(9)
    // backtick info strings may not contain backticks (that is inline code, not a fence)
    expect(lastFenceOpen("```not`a fence")).toBe(false)
  })

  it("hashes content stably", () => {
    expect(contentHash("abc")).toBe(contentHash("abc"))
    expect(contentHash("abc")).not.toBe(contentHash("abd"))
  })
})

describe("chart spec", () => {
  const line = {
    type: "line",
    title: "Monthly revenue",
    subtitle: "Illustrative sample data",
    x: ["Jan", "Feb", "Mar", "Apr"],
    series: [{ name: "Revenue", data: [12000, 15800, 13200, 21500] }],
    format: "currency:EUR",
  }

  it("accepts the documented example", () => {
    const r = parseChartSpec(JSON.stringify(line))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.spec.title).toBe("Monthly revenue")
    expect(r.spec.views).toHaveLength(1)
    const v = r.spec.views[0]!
    expect(v.type).toBe("line")
    expect(v.format).toEqual({ kind: "currency", currency: "EUR" })
    if (v.type === "line") expect(v.series[0]!.data).toEqual([12000, 15800, 13200, 21500])
  })

  it("expands datasets, inheriting top-level fields", () => {
    const r = validateChartSpec({
      type: "bar",
      x: ["Q1", "Q2"],
      stacked: true,
      datasets: [
        { label: "Revenue", series: [{ name: "EU", data: [1, 2] }], format: "compact" },
        {
          label: "Conversion",
          type: "line",
          format: "percent",
          series: [{ name: "Rate", data: [0.1, 0.2] }],
        },
      ],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.spec.views.map((v) => [v.label, v.type, v.format.kind])).toEqual([
      ["Revenue", "bar", "compact"],
      ["Conversion", "line", "percent"],
    ])
    const first = r.spec.views[0]!
    expect(first.type === "bar" && first.stacked).toBe(true)
  })

  it("accepts pie and donut slices", () => {
    const r = validateChartSpec({
      type: "donut",
      series: [
        {
          name: "Share",
          data: [
            { name: "A", value: 3 },
            { name: "B", value: 1, color: "#123456" },
          ],
        },
      ],
    })
    expect(r.ok).toBe(true)
    if (r.ok && r.spec.views[0]!.type === "donut") {
      const v = r.spec.views[0]!
      expect(v.type === "donut" && v.slices).toEqual([
        { name: "A", value: 3, color: undefined },
        { name: "B", value: 1, color: "#123456" },
      ])
    }
  })

  it("pads short series and rejects long ones", () => {
    const short = validateChartSpec({ type: "line", x: ["a", "b", "c"], series: [{ name: "s", data: [1] }] })
    expect(short.ok && short.spec.views[0]!.type === "line" && short.spec.views[0]!.series[0]!.data).toEqual([
      1,
      null,
      null,
    ])
    const long = validateChartSpec({ type: "line", x: ["a"], series: [{ name: "s", data: [1, 2] }] })
    expect(long).toEqual({ ok: false, error: 'series "s" has 2 values but "x" has 1 categories' })
  })

  it("rejects invalid input with a clear message", () => {
    expect(parseChartSpec("{nope")).toMatchObject({
      ok: false,
      error: expect.stringContaining("invalid JSON"),
    })
    expect(validateChartSpec([])).toEqual({ ok: false, error: "the chart spec must be a JSON object" })
    expect(validateChartSpec({ type: "radar", series: [] })).toMatchObject({
      ok: false,
      error: expect.stringContaining('unknown type "radar"'),
    })
    expect(validateChartSpec({ series: [{ data: [1] }] })).toMatchObject({
      error: expect.stringContaining("type"),
    })
    expect(validateChartSpec({ type: "bar", series: [{ name: "s", data: ["1"] }] })).toMatchObject({
      error: 'series "s" value 1 must be a number or null',
    })
    expect(validateChartSpec({ type: "bar", format: "money", series: [{ data: [1] }] })).toMatchObject({
      error: expect.stringContaining('unknown format "money"'),
    })
    expect(
      validateChartSpec({ type: "bar", series: [{ data: [1], color: "red;background:url(x)" }] }),
    ).toMatchObject({ ok: false })
    expect(validateChartSpec({ type: "pie", series: [{ data: [{ name: "a", value: -1 }] }] })).toMatchObject({
      ok: false,
    })
    expect(validateChartSpec({ type: "line", yMin: 5, yMax: 1, series: [{ data: [1] }] })).toMatchObject({
      error: '"yMin" must be below "yMax"',
    })
  })

  it("enforces the series and point limits", () => {
    const tooMany = Array.from({ length: MAX_SERIES + 1 }, (_, i) => ({ name: `s${i}`, data: [1] }))
    expect(validateChartSpec({ type: "line", series: tooMany })).toMatchObject({
      error: `"series" has ${MAX_SERIES + 1} series (at most ${MAX_SERIES})`,
    })
    const long = Array.from({ length: MAX_POINTS + 1 }, (_, i) => i)
    expect(validateChartSpec({ type: "line", series: [{ name: "s", data: long }] })).toMatchObject({
      error: `series "s" has ${MAX_POINTS + 1} points (at most ${MAX_POINTS})`,
    })
    const ok = Array.from({ length: MAX_POINTS }, (_, i) => i)
    expect(validateChartSpec({ type: "line", series: [{ name: "s", data: ok }] }).ok).toBe(true)
  })

  it("formats values", () => {
    expect(formatValue(0.123, { kind: "percent" })).toMatch(/12[.,]3\s?%/)
    expect(formatValue(1500, { kind: "compact" })).toMatch(/1[.,]5\s?K/i)
    expect(formatValue(21500, { kind: "currency", currency: "EUR" })).toContain("21")
    expect(formatValue(null, { kind: "number" })).toBe("–")
    // an unknown currency falls back to a plain number instead of throwing
    expect(formatValue(5, { kind: "currency", currency: "ZZZ" })).toBeTruthy()
  })

  it("builds round axis ticks with distinct labels", () => {
    const money = niceScale(0, 24100)
    expect(money.ticks).toEqual([0, 5000, 10000, 15000, 20000, 25000])
    expect(formatAxisValue(15000, { kind: "number" }, money.decimals)).toMatch(/^15\s?K$/i)

    const rate = niceScale(0.021, 0.033)
    const labels = rate.ticks.map((t) => formatAxisValue(t, { kind: "percent" }, rate.decimals))
    expect(new Set(labels).size).toBe(labels.length)
    expect(rate.domain[0]).toBeLessThanOrEqual(0.021)
    expect(rate.domain[1]).toBeGreaterThanOrEqual(0.033)

    expect(niceScale(5, 5).ticks[0]).toBe(0)
    expect(niceScale(0, 0).domain).toEqual([0, 1])
    expect(niceScale(-3, 7).ticks).toContain(0)
  })
})

describe("svg sanitising", () => {
  it("strips scripts, handlers, foreignObject and external references", () => {
    const r = sanitizeSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)">
        <script>alert(2)</script>
        <foreignObject><div>x</div></foreignObject>
        <defs><circle id="c" r="2"/></defs>
        <use href="#c" />
        <image href="https://evil.example/x.png" />
        <a xlink:href="javascript:alert(3)"><rect width="1" height="1" onclick="alert(4)" style="fill:url(https://evil.example/p)"/></a>
      </svg>`,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.svg).not.toMatch(/script|onload|onclick|foreignObject|evil\.example|javascript:/i)
    expect(r.svg).toContain('href="#c"')
    expect(r.dataURL.startsWith("data:image/svg+xml")).toBe(true)
  })

  it("adds a missing namespace and keeps explicit sizes", () => {
    const r = sanitizeSvg('<svg width="120" height="40"><rect width="10" height="10"/></svg>')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.svg).toContain('xmlns="http://www.w3.org/2000/svg"')
      expect(r.width).toBe(120)
    }
  })

  it("rejects anything that is not a single svg document", () => {
    expect(sanitizeSvg("<html><body/></html>")).toMatchObject({ ok: false })
    expect(sanitizeSvg("<svg><g></svg>")).toMatchObject({ ok: false })
    expect(sanitizeSvg("not markup")).toMatchObject({ ok: false })
    expect(sanitizeSvg("")).toMatchObject({ ok: false })
    expect(sanitizeSvg('<!DOCTYPE svg [<!ENTITY x "y">]><svg/>')).toMatchObject({ ok: false })
  })
})

describe("widget helpers", () => {
  it("parses the widget bridge messages", () => {
    expect(parseArtifactMessage({ type: "opal:resize", height: 120.2 })).toEqual({
      type: "opal:resize",
      height: 121,
    })
    expect(parseArtifactMessage({ type: "opal:resize", height: "120" })).toBeUndefined()
    expect(parseArtifactMessage({ type: "opal:resize", height: -1 })).toBeUndefined()
    expect(parseArtifactMessage({ type: "opal:prompt", text: "  hi  " })).toEqual({
      type: "opal:prompt",
      text: "hi",
    })
    expect(parseArtifactMessage({ type: "opal:prompt", text: "   " })).toBeUndefined()
    const long = parseArtifactMessage({ type: "opal:prompt", text: "x".repeat(9000) })
    expect(long?.type === "opal:prompt" && long.text.length).toBe(8000)
  })

  it("clamps frame heights to 80–640", () => {
    expect(clampFrameHeight(10)).toBe(80)
    expect(clampFrameHeight(300.2)).toBe(301)
    expect(clampFrameHeight(5000)).toBe(640)
  })

  it("rate-limits prompts to one per second", () => {
    let t = 0
    const allow = makeRateLimiter(1000, () => t)
    expect(allow()).toBe(true)
    t = 500
    expect(allow()).toBe(false)
    t = 1000
    expect(allow()).toBe(true)
  })
})
