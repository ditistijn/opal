/**
 * Validation + formatting for ` ```chart ` blocks (docs/INLINE-WIDGETS.md §1 "Chart spec").
 * Hand-written (no schema library) so the chat bundle stays small; every failure carries a message
 * that is shown under the raw block ("Not a valid chart: …").
 */

export const CHART_TYPES = ["line", "area", "bar", "pie", "donut"] as const
export type ChartType = (typeof CHART_TYPES)[number]

export const MAX_SERIES = 12
export const MAX_POINTS = 500
export const MAX_DATASETS = 8
/** Upper bound on the raw block before we even try JSON.parse. */
export const MAX_SPEC_CHARS = 200_000

export type ChartFormat =
  { kind: "number" } | { kind: "compact" } | { kind: "percent" } | { kind: "currency"; currency: string }

export interface CartesianSeries {
  name: string
  data: (number | null)[]
  color?: string
}

export interface PieSlice {
  name: string
  value: number
  color?: string
}

interface ViewBase {
  /** Tab label (datasets) — undefined for a single-view chart. */
  label?: string
  format: ChartFormat
}

export interface CartesianView extends ViewBase {
  type: "line" | "area" | "bar"
  x: string[]
  series: CartesianSeries[]
  stacked: boolean
  yMin?: number
  yMax?: number
}

export interface PieView extends ViewBase {
  type: "pie" | "donut"
  /** Name of the (single) series. */
  seriesName: string
  slices: PieSlice[]
}

export type ChartView = CartesianView | PieView

export function isPieView(view: ChartView): view is PieView {
  return view.type === "pie" || view.type === "donut"
}

export interface ChartSpec {
  title?: string
  subtitle?: string
  note?: string
  /** One entry per dataset tab (a single entry when `datasets` is absent). */
  views: ChartView[]
}

export type ChartParseResult = { ok: true; spec: ChartSpec } | { ok: false; error: string }

class SpecError extends Error {}

function fail(message: string): never {
  throw new SpecError(message)
}

type Obj = Record<string, unknown>

function isObj(v: unknown): v is Obj {
  return !!v && typeof v === "object" && !Array.isArray(v)
}

function optString(v: unknown, field: string, max = 200): string | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v !== "string") fail(`"${field}" must be a string`)
  const s = v.trim()
  return s ? s.slice(0, max) : undefined
}

function optNumber(v: unknown, field: string): number | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v !== "number" || !Number.isFinite(v)) fail(`"${field}" must be a number`)
  return v
}

/** CSS colors only: hex, named, rgb()/hsl()/oklch()/var(); nothing that could break out of a value. */
const SAFE_COLOR =
  /^(#[0-9a-f]{3,8}|[a-z]{3,30}|(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color|var)\([-\w\s.,%/#]*\))$/i

function optColor(v: unknown, field: string): string | undefined {
  const s = optString(v, field, 80)
  if (s === undefined) return undefined
  if (!SAFE_COLOR.test(s)) fail(`"${field}" is not a CSS color: ${s}`)
  return s
}

export function parseFormat(v: unknown): ChartFormat | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v !== "string") fail(`"format" must be a string`)
  const s = v.trim()
  if (s === "number") return { kind: "number" }
  if (s === "compact") return { kind: "compact" }
  if (s === "percent") return { kind: "percent" }
  const m = /^currency:([a-z]{3})$/i.exec(s)
  if (m) return { kind: "currency", currency: m[1]!.toUpperCase() }
  fail(`unknown format "${s}" (use number, compact, percent or currency:<ISO code>)`)
}

function parseType(v: unknown, field: string): ChartType | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v !== "string" || !(CHART_TYPES as readonly string[]).includes(v))
    fail(`unknown ${field} ${JSON.stringify(v)} (use ${CHART_TYPES.join(", ")})`)
  return v as ChartType
}

function parseX(v: unknown, field: string): string[] | undefined {
  if (v === undefined || v === null) return undefined
  if (!Array.isArray(v)) fail(`"${field}" must be an array of category labels`)
  if (v.length > MAX_POINTS) fail(`"${field}" has ${v.length} categories (at most ${MAX_POINTS})`)
  return v.map((c, i) => {
    if (typeof c === "string") return c.slice(0, 80)
    if (typeof c === "number" && Number.isFinite(c)) return String(c)
    fail(`"${field}[${i}]" must be a string or number`)
  })
}

function seriesArray(v: unknown, field: string): Obj[] {
  if (!Array.isArray(v) || v.length === 0) fail(`"${field}" must be a non-empty array`)
  if (v.length > MAX_SERIES) fail(`"${field}" has ${v.length} series (at most ${MAX_SERIES})`)
  return v.map((s, i) => (isObj(s) ? s : fail(`"${field}[${i}]" must be an object`)))
}

function cartesianSeries(
  raw: Obj[],
  field: string,
  x: string[] | undefined,
): { x: string[]; series: CartesianSeries[] } {
  const series = raw.map((s, i): CartesianSeries => {
    const name = optString(s.name, `${field}[${i}].name`, 80) ?? `Series ${i + 1}`
    if (!Array.isArray(s.data)) fail(`series "${name}" needs a "data" array of numbers`)
    if (s.data.length > MAX_POINTS)
      fail(`series "${name}" has ${s.data.length} points (at most ${MAX_POINTS})`)
    const data = s.data.map((d, j) => {
      if (d === null) return null
      if (typeof d === "number" && Number.isFinite(d)) return d
      fail(`series "${name}" value ${j + 1} must be a number or null`)
    })
    return { name, data, color: optColor(s.color, `${field}[${i}].color`) }
  })
  const longest = Math.max(...series.map((s) => s.data.length))
  const categories = x ?? Array.from({ length: longest }, (_, i) => String(i + 1))
  for (const s of series) {
    if (s.data.length > categories.length)
      fail(`series "${s.name}" has ${s.data.length} values but "x" has ${categories.length} categories`)
    // shorter series leave gaps at the end
    while (s.data.length < categories.length) s.data.push(null)
  }
  return { x: categories, series }
}

function pieSlices(
  raw: Obj[],
  field: string,
  x: string[] | undefined,
): { seriesName: string; slices: PieSlice[] } {
  const first = raw[0]!
  const seriesName = optString(first.name, `${field}[0].name`, 80) ?? "Value"
  if (!Array.isArray(first.data) || first.data.length === 0)
    fail(`pie series "${seriesName}" needs a non-empty "data" array of { "name", "value" }`)
  if (first.data.length > MAX_POINTS)
    fail(`pie series has ${first.data.length} slices (at most ${MAX_POINTS})`)
  const slices = first.data.map((d, j): PieSlice => {
    // also accept plain numbers labelled by "x"
    if (typeof d === "number" && x?.[j] !== undefined) d = { name: x[j], value: d }
    if (!isObj(d)) fail(`pie slice ${j + 1} must be { "name": "…", "value": 12 }`)
    const name = optString(d.name, `slice ${j + 1} name`, 80) ?? `Slice ${j + 1}`
    const value = d.value
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
      fail(`pie slice "${name}" needs a non-negative numeric "value"`)
    return { name, value, color: optColor(d.color, `slice "${name}" color`) }
  })
  return { seriesName, slices }
}

interface Defaults {
  type?: ChartType
  format?: ChartFormat
  x?: string[]
  stacked: boolean
  yMin?: number
  yMax?: number
}

function buildView(src: Obj, field: string, defaults: Defaults, label?: string): ChartView {
  const type = parseType(src.type, "type") ?? defaults.type
  if (!type) fail(`missing "type" (use ${CHART_TYPES.join(", ")})`)
  const format = parseFormat(src.format) ?? defaults.format ?? { kind: "number" }
  const x = parseX(src.x, "x") ?? defaults.x
  const raw = seriesArray(src.series, field)
  if (type === "pie" || type === "donut") return { type, label, format, ...pieSlices(raw, field, x) }
  const yMin = optNumber(src.yMin, "yMin") ?? defaults.yMin
  const yMax = optNumber(src.yMax, "yMax") ?? defaults.yMax
  if (yMin !== undefined && yMax !== undefined && yMin >= yMax) fail(`"yMin" must be below "yMax"`)
  const stacked = typeof src.stacked === "boolean" ? src.stacked : defaults.stacked
  return { type, label, format, stacked, yMin, yMax, ...cartesianSeries(raw, field, x) }
}

/** Validates an already-parsed JSON value. */
export function validateChartSpec(value: unknown): ChartParseResult {
  try {
    if (!isObj(value)) fail("the chart spec must be a JSON object")
    const defaults: Defaults = {
      type: parseType(value.type, "type"),
      format: parseFormat(value.format),
      x: parseX(value.x, "x"),
      stacked: value.stacked === true,
      yMin: optNumber(value.yMin, "yMin"),
      yMax: optNumber(value.yMax, "yMax"),
    }
    let views: ChartView[]
    if (value.datasets !== undefined && value.datasets !== null) {
      const ds = value.datasets
      if (!Array.isArray(ds) || ds.length === 0) fail(`"datasets" must be a non-empty array`)
      if (ds.length > MAX_DATASETS) fail(`"datasets" has ${ds.length} entries (at most ${MAX_DATASETS})`)
      views = ds.map((d, i) => {
        if (!isObj(d)) fail(`"datasets[${i}]" must be an object`)
        const label = optString(d.label, `datasets[${i}].label`, 40) ?? `Dataset ${i + 1}`
        return buildView(d, `datasets[${i}].series`, defaults, label)
      })
    } else {
      if (!defaults.type) fail(`missing "type" (use ${CHART_TYPES.join(", ")})`)
      views = [buildView(value, "series", defaults)]
    }
    return {
      ok: true,
      spec: {
        title: optString(value.title, "title", 120),
        subtitle: optString(value.subtitle, "subtitle", 200),
        note: optString(value.note, "note", 500),
        views,
      },
    }
  } catch (err) {
    if (err instanceof SpecError) return { ok: false, error: err.message }
    throw err
  }
}

/** Parses the body of a ` ```chart ` block. */
export function parseChartSpec(text: string): ChartParseResult {
  if (text.length > MAX_SPEC_CHARS) return { ok: false, error: "the chart spec is too large" }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `invalid JSON (${detail})` }
  }
  return validateChartSpec(value)
}

// ---------- formatting ----------

const formatters = new Map<string, Intl.NumberFormat>()

function numberFormat(key: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  let f = formatters.get(key)
  if (!f) {
    try {
      f = new Intl.NumberFormat(undefined, options)
    } catch {
      // e.g. an unknown currency code
      f = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })
    }
    formatters.set(key, f)
  }
  return f
}

/** Formats a value for tooltips and labels (full precision, up to two decimals). */
export function formatValue(value: number | null | undefined, format: ChartFormat): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–"
  switch (format.kind) {
    case "percent":
      return numberFormat("pct", { style: "percent", maximumFractionDigits: 1 }).format(value)
    case "compact":
      return numberFormat("compact", { notation: "compact", maximumFractionDigits: 1 }).format(value)
    case "currency": {
      const decimals = Math.abs(value) >= 100 ? 0 : 2
      return numberFormat(`cur:${format.currency}:${decimals}`, {
        style: "currency",
        currency: format.currency,
        maximumFractionDigits: decimals,
        minimumFractionDigits: 0,
      }).format(value)
    }
    default:
      return numberFormat("num", { maximumFractionDigits: 2 }).format(value)
  }
}

/**
 * Formats a value-axis tick. `decimals` comes from the tick step (see niceScale) so neighbouring
 * ticks never print the same label; from 1,000 up the axis uses compact notation (12K, 1.5M).
 */
export function formatAxisValue(value: number, format: ChartFormat, decimals = 0): string {
  if (!Number.isFinite(value)) return ""
  const compact = format.kind === "compact" || Math.abs(value) >= 1_000
  const digits = Math.min(4, Math.max(0, decimals))
  switch (format.kind) {
    case "percent": {
      const d = Math.min(4, Math.max(0, digits - 2))
      return numberFormat(`axis-pct:${d}`, { style: "percent", maximumFractionDigits: d }).format(value)
    }
    case "currency":
      return numberFormat(`axis-cur:${format.currency}:${compact}:${digits}`, {
        style: "currency",
        currency: format.currency,
        notation: compact ? "compact" : "standard",
        maximumFractionDigits: compact ? 2 : digits,
        minimumFractionDigits: 0,
      }).format(value)
    default:
      if (compact)
        return numberFormat("axis-compact", { notation: "compact", maximumFractionDigits: 2 }).format(value)
      return numberFormat(`axis-num:${digits}`, { maximumFractionDigits: digits }).format(value)
  }
}

export interface NiceScale {
  ticks: number[]
  domain: [number, number]
  step: number
  /** Fraction digits needed to print every tick distinctly. */
  decimals: number
}

/** Round tick values (steps of 1, 2, 2.5 or 5 × 10^k) covering [min, max] with about `count` ticks. */
export function niceScale(min: number, max: number, count = 5): NiceScale {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0
    max = 1
  }
  if (min > max) [min, max] = [max, min]
  if (min === max) {
    if (min === 0) max = 1
    else if (min > 0) min = 0
    else max = 0
  }
  const round = (v: number) => Number(v.toFixed(12))
  const exp0 = Math.floor(Math.log10((max - min) / Math.max(1, count - 1)))
  // smallest round step that needs at most count + 1 ticks
  let pick = { m: 1, exp: exp0 + 1 }
  for (const [m, exp] of [
    [1, exp0],
    [2, exp0],
    [2.5, exp0],
    [5, exp0],
    [1, exp0 + 1],
    [2, exp0 + 1],
    [2.5, exp0 + 1],
    [5, exp0 + 1],
  ] as const) {
    const step = m * 10 ** exp
    const n = Math.round(Math.ceil(max / step - 1e-9) - Math.floor(min / step + 1e-9) + 1)
    if (n <= count + 1) {
      pick = { m, exp }
      break
    }
  }
  const step = pick.m * 10 ** pick.exp
  const lo = round(Math.floor(min / step + 1e-9) * step)
  const hi = round(Math.ceil(max / step - 1e-9) * step)
  const ticks: number[] = []
  for (let i = 0; i <= 100; i++) {
    const v = round(lo + i * step)
    if (v > hi + step / 2) break
    ticks.push(v)
  }
  const decimals = Math.max(0, -pick.exp) + (pick.m === 2.5 ? 1 : 0)
  return { ticks, domain: [lo, hi], step, decimals }
}
