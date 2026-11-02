/**
 * Native chart for ` ```chart ` blocks (Recharts). Loaded lazily by InlineBlock, so Recharts is its own
 * chunk. Colors come from the --chart-N tokens in inline.css, resolved per theme.
 */
import { useMemo, useState } from "react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useDocumentTheme } from "@/features/artifacts/hooks"
import { cn } from "@/lib/utils"
import {
  formatAxisValue,
  formatValue,
  isPieView,
  niceScale,
  type NiceScale,
  type CartesianView,
  type ChartFormat,
  type ChartSpec,
  type ChartView,
  type PieView,
} from "./chart-spec"

const CHART_HEIGHT = 280

const FALLBACK_PALETTE = [
  "#2a78d6",
  "#eb6834",
  "#1baf7a",
  "#eda100",
  "#e87ba4",
  "#008300",
  "#6250d6",
  "#e34948",
  "#5e5d59",
  "#b4b2a9",
  "#256abf",
  "#c9663f",
]

interface Ink {
  palette: string[]
  fgMuted: string
  muted: string
  fg: string
  border: string
  surface: string
}

function readInk(): Ink {
  const css = typeof window !== "undefined" ? getComputedStyle(document.documentElement) : undefined
  const read = (name: string, fallback: string) => css?.getPropertyValue(name).trim() || fallback
  return {
    palette: FALLBACK_PALETTE.map((c, i) => read(`--chart-${i + 1}`, c)),
    fgMuted: read("--fg-muted", "#87867f"),
    muted: read("--bg-muted", "#f3f1ea"),
    fg: read("--fg", "#141413"),
    border: read("--border", "rgba(20, 20, 19, 0.10)"),
    surface: read("--bg-elevated", "#ffffff"),
  }
}

/** Theme colors resolved to concrete values (SVG presentation attributes do not see CSS variables everywhere). */
function useInk(): Ink {
  const theme = useDocumentTheme()
  // recomputed when the theme flips
  return useMemo(() => (theme ? readInk() : readInk()), [theme])
}

interface LegendItem {
  key: string
  name: string
  color: string
}

export default function InlineChart({ spec }: { spec: ChartSpec }) {
  const [tab, setTab] = useState("0")
  const views = spec.views
  if (views.length === 1) return <ChartPanel view={views[0]!} />
  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList aria-label="Datasets" className="mb-2">
        {views.map((v, i) => (
          <TabsTrigger key={i} value={String(i)}>
            {v.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {/* only the active view is mounted, so each switch animates in */}
      <ChartPanel key={tab} view={views[Number(tab)] ?? views[0]!} />
    </Tabs>
  )
}

function ChartPanel({ view }: { view: ChartView }) {
  const ink = useInk()
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set())
  const items: LegendItem[] = isPieView(view)
    ? view.slices.map((s, i) => ({ key: `p${i}`, name: s.name, color: s.color ?? ink.palette[i % 12]! }))
    : view.series.map((s, i) => ({ key: `s${i}`, name: s.name, color: s.color ?? ink.palette[i % 12]! }))
  const toggle = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else if (next.size < items.length - 1) next.add(key) // keep at least one visible
      return next
    })
  return (
    <div className="opal-inline-chart" data-chart-type={view.type}>
      <div style={{ height: CHART_HEIGHT }} className="w-full">
        {isPieView(view) ? (
          <PieChartPanel view={view} items={items} hidden={hidden} ink={ink} />
        ) : (
          <CartesianChart view={view} items={items} hidden={hidden} ink={ink} />
        )}
      </div>
      {items.length > 1 ? <Legend items={items} hidden={hidden} onToggle={toggle} /> : null}
      <DataTable view={view} />
    </div>
  )
}

function Legend({
  items,
  hidden,
  onToggle,
}: {
  items: LegendItem[]
  hidden: ReadonlySet<string>
  onToggle(key: string): void
}) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-1 gap-y-0.5" role="group" aria-label="Legend">
      {items.map((it) => {
        const off = hidden.has(it.key)
        return (
          <button
            key={it.key}
            type="button"
            aria-pressed={!off}
            onClick={() => onToggle(it.key)}
            className={cn(
              "flex h-6 items-center gap-1.5 rounded-md px-1.5 text-[12.5px] transition-fast hover:bg-bg-muted focus-visible:outline-2 focus-visible:outline-ring",
              off ? "text-fg-faint" : "text-fg-secondary",
            )}
          >
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-[3px]"
              style={{
                background: off ? "transparent" : it.color,
                boxShadow: `inset 0 0 0 1.5px ${it.color}`,
              }}
            />
            {it.name}
          </button>
        )
      })}
    </div>
  )
}

function TooltipCard({
  label,
  rows,
  format,
}: {
  label?: string
  rows: { name: string; color: string; value: number | null }[]
  format: ChartFormat
}) {
  return (
    <div className="min-w-32 rounded-lg border border-border bg-bg-elevated px-2.5 py-2 text-[12.5px] shadow-elevated">
      {label ? <div className="mb-1 font-medium text-fg">{label}</div> : null}
      {rows.map((r) => (
        <div key={r.name} className="flex items-center gap-2 leading-5">
          <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: r.color }} />
          <span className="min-w-0 flex-1 truncate text-fg-secondary">{r.name}</span>
          <span className="pl-3 font-medium tabular-nums text-fg">{formatValue(r.value, format)}</span>
        </div>
      ))}
    </div>
  )
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null
}

/** Value range of the visible series (per-category sums when stacked). */
function valueRange(view: CartesianView, visible: ReadonlySet<number>): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  const take = (v: number) => {
    lo = Math.min(lo, v)
    hi = Math.max(hi, v)
  }
  view.x.forEach((_, i) => {
    let pos = 0
    let neg = 0
    view.series.forEach((s, j) => {
      const d = s.data[i]
      if (!visible.has(j) || d === null || d === undefined) return
      if (!view.stacked) take(d)
      else if (d >= 0) pos += d
      else neg += d
    })
    if (view.stacked) {
      take(pos)
      take(neg)
    }
  })
  return Number.isFinite(lo) ? [lo, hi] : [0, 1]
}

function valueScale(view: CartesianView, visible: ReadonlySet<number>): NiceScale {
  let [lo, hi] = valueRange(view, visible)
  // bars and areas encode magnitude from zero; lines may zoom in on the range
  if (view.type !== "line") {
    lo = Math.min(lo, 0)
    hi = Math.max(hi, 0)
  }
  if (view.yMin !== undefined) lo = view.yMin
  if (view.yMax !== undefined) hi = view.yMax
  const scale = niceScale(lo, hi)
  if (view.yMin === undefined && view.yMax === undefined) return scale
  const domain: [number, number] = [view.yMin ?? scale.domain[0], view.yMax ?? scale.domain[1]]
  return {
    ...scale,
    domain,
    ticks: scale.ticks.filter((t) => t >= domain[0] - 1e-9 && t <= domain[1] + 1e-9),
  }
}

function axisWidth(scale: NiceScale, format: ChartFormat): number {
  const longest = Math.max(...scale.ticks.map((t) => formatAxisValue(t, format, scale.decimals).length))
  return Math.min(88, Math.max(28, longest * 7 + 12))
}

function CartesianChart({
  view,
  items,
  hidden,
  ink,
}: {
  view: CartesianView
  items: LegendItem[]
  hidden: ReadonlySet<string>
  ink: Ink
}) {
  const rows = useMemo(
    () =>
      view.x.map((x, i) => {
        const row: Record<string, string | number | null> = { __x: x }
        view.series.forEach((s, j) => (row[`s${j}`] = s.data[i] ?? null))
        return row
      }),
    [view],
  )
  const tick = { fill: ink.fgMuted, fontSize: 12 }
  const format = view.format
  const visible = items.map((it, i) => ({ ...it, index: i })).filter((it) => !hidden.has(it.key))
  const lastVisible = visible[visible.length - 1]?.key
  const scale = valueScale(view, new Set(visible.map((v) => v.index)))
  const stack = view.stacked ? "stack" : undefined
  const showDots = view.x.length <= 16

  const common = (
    <>
      <CartesianGrid vertical={false} stroke={ink.border} />
      <XAxis
        dataKey="__x"
        tick={tick}
        tickLine={false}
        axisLine={{ stroke: ink.border }}
        tickMargin={8}
        minTickGap={12}
        interval="preserveStartEnd"
        padding={view.type === "bar" ? undefined : { left: 10, right: 10 }}
      />
      <YAxis
        tick={tick}
        tickLine={false}
        axisLine={false}
        tickMargin={6}
        width={axisWidth(scale, format)}
        domain={scale.domain}
        ticks={scale.ticks}
        interval={0}
        allowDataOverflow
        tickFormatter={(v: number) => formatAxisValue(v, format, scale.decimals)}
      />
      <Tooltip
        cursor={view.type === "bar" ? { fill: ink.muted } : { stroke: ink.fgMuted, strokeDasharray: "3 3" }}
        isAnimationActive={false}
        content={(p: TooltipContentProps) =>
          p.active && p.payload.length ? (
            <TooltipCard
              label={p.label === undefined ? undefined : String(p.label)}
              format={format}
              rows={p.payload.map((e) => ({
                name: String(e.name ?? ""),
                color: String(e.color ?? e.stroke ?? e.fill ?? ink.fg),
                value: asNumber(e.value),
              }))}
            />
          ) : null
        }
      />
    </>
  )
  const margin = { top: 8, right: 8, bottom: 0, left: 0 }

  if (view.type === "bar")
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={margin} accessibilityLayer barCategoryGap="22%" barGap={2}>
          {common}
          {visible.map((it) => (
            <Bar
              key={it.key}
              dataKey={it.key}
              name={it.name}
              fill={it.color}
              stackId={stack}
              maxBarSize={44}
              radius={!stack || it.key === lastVisible ? [4, 4, 0, 0] : 0}
              stroke={stack ? ink.surface : undefined}
              strokeWidth={stack ? 1 : 0}
              animationDuration={450}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    )
  if (view.type === "area")
    return (
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={margin} accessibilityLayer>
          {common}
          {visible.map((it) => (
            <Area
              key={it.key}
              type="monotone"
              dataKey={it.key}
              name={it.name}
              stroke={it.color}
              strokeWidth={2}
              fill={it.color}
              fillOpacity={stack ? 0.45 : 0.14}
              stackId={stack}
              activeDot={{ r: 4, strokeWidth: 2, stroke: ink.surface }}
              animationDuration={450}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    )
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={rows} margin={margin} accessibilityLayer>
        {common}
        {visible.map((it) => (
          <Line
            key={it.key}
            type="monotone"
            dataKey={it.key}
            name={it.name}
            stroke={it.color}
            strokeWidth={2}
            dot={showDots ? { r: 2.5, strokeWidth: 0, fill: it.color } : false}
            activeDot={{ r: 4.5, strokeWidth: 2, stroke: ink.surface }}
            animationDuration={450}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

function PieChartPanel({
  view,
  items,
  hidden,
  ink,
}: {
  view: PieView
  items: LegendItem[]
  hidden: ReadonlySet<string>
  ink: Ink
}) {
  // color follows the slice, not its position among the visible ones
  const data = view.slices
    .map((s, i) => ({ name: s.name, value: s.value, color: items[i]!.color, key: items[i]!.key }))
    .filter((d) => !hidden.has(d.key))
  const total = data.reduce((sum, d) => sum + d.value, 0)
  const donut = view.type === "donut"
  return (
    <div className="relative h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart accessibilityLayer>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            startAngle={90}
            endAngle={-270}
            innerRadius={donut ? "58%" : 0}
            outerRadius="88%"
            paddingAngle={donut && data.length > 1 ? 1.5 : 0}
            stroke={ink.surface}
            strokeWidth={2}
            animationDuration={450}
          >
            {data.map((d) => (
              <Cell key={d.key} fill={d.color} />
            ))}
          </Pie>
          <Tooltip
            isAnimationActive={false}
            content={(p: TooltipContentProps) => {
              const e = p.payload[0]
              if (!p.active || !e) return null
              const value = asNumber(e.value)
              const share = total > 0 && value !== null ? ` (${Math.round((value / total) * 100)}%)` : ""
              return (
                <TooltipCard
                  format={view.format}
                  rows={[
                    {
                      name: `${String(e.name ?? "")}${share}`,
                      color: String((e.payload as { color?: string } | undefined)?.color ?? ink.fg),
                      value,
                    },
                  ]}
                />
              )
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      {donut ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[18px] font-semibold tabular-nums text-fg">
            {formatValue(total, view.format)}
          </span>
          <span className="text-[11.5px] text-fg-muted">{view.seriesName}</span>
        </div>
      ) : null}
    </div>
  )
}

/** Screen-reader table of the same data (the chart itself is not readable). */
function DataTable({ view }: { view: ChartView }) {
  if (isPieView(view))
    return (
      <table className="sr-only">
        <tbody>
          {view.slices.map((s, i) => (
            <tr key={i}>
              <th scope="row">{s.name}</th>
              <td>{formatValue(s.value, view.format)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  return (
    <table className="sr-only">
      <thead>
        <tr>
          <th scope="col" />
          {view.series.map((s, i) => (
            <th key={i} scope="col">
              {s.name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {view.x.map((x, i) => (
          <tr key={i}>
            <th scope="row">{x}</th>
            {view.series.map((s, j) => (
              <td key={j}>{formatValue(s.data[i], view.format)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
