/** Sample artifacts for the dev story and tests — one per kind, plus a broken one. */
export const SAMPLE_ARTIFACTS: { id: string; title: string; entry: string; files: Record<string, string> }[] =
  [
    {
      id: "art_html",
      title: "Pomodoro timer",
      entry: "index.html",
      files: {
        "index.html": `<!doctype html>
<html><head><meta charset="utf-8"><title>Pomodoro</title>
<script src="/_runtime/error-bridge.js"></script>
<link rel="stylesheet" href="style.css"></head>
<body><main><h1>Focus</h1><div id="t">25:00</div><button id="go">Start</button>
<p><a href="https://example.com">Learn more</a></p></main>
<script src="app.js"></script></body></html>`,
        "style.css": `body{font-family:-apple-system,system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#fdf6f0}
main{text-align:center}h1{font-weight:500;color:#9a3412}#t{font-size:72px;font-variant-numeric:tabular-nums;margin:12px 0}
button{font-size:16px;padding:8px 22px;border-radius:999px;border:0;background:#c2410c;color:#fff}`,
        "app.js": `let s=1500,h;document.getElementById('go').onclick=()=>{clearInterval(h);h=setInterval(()=>{s--;document.getElementById('t').textContent=String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0')},1000)}`,
      },
    },
    {
      id: "art_react",
      title: "Revenue dashboard",
      entry: "App.tsx",
      files: {
        "App.tsx": `import { useState } from "react"
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts"
import { TrendingUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { data, total } from "./data"

type Range = "6m" | "12m"

export default function App() {
  const [range, setRange] = useState<Range>("12m")
  const rows = range === "6m" ? data.slice(-6) : data
  return (
    <div className="min-h-screen bg-neutral-50 p-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><TrendingUp className="h-5 w-5 text-orange-600" /> Revenue · \${total(rows).toLocaleString()}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex gap-2">
            {(["6m", "12m"] as Range[]).map((r) => (
              <Button key={r} size="sm" variant={r === range ? "default" : "outline"} onClick={() => setRange(r)}>{r}</Button>
            ))}
          </div>
          <div style={{ height: 260 }}>
            <ResponsiveContainer>
              <LineChart data={rows}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="m" /><YAxis /><Tooltip />
                <Line type="monotone" dataKey="v" stroke="#c2410c" strokeWidth={2} /></LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
`,
        "data.ts": `export interface Row { m: string; v: number }
export const data: Row[] = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((m, i) => ({ m, v: Math.round(4000 + i * 650 + Math.sin(i) * 900) }))
export const total = (rows: Row[]) => rows.reduce((n, r) => n + r.v, 0)
`,
      },
    },
    {
      id: "art_md",
      title: "Onboarding guide",
      entry: "index.md",
      files: {
        "index.md": `# Onboarding guide

Welcome to the team! This document covers **everything** you need for your first week.

## Day one

1. Pick up your laptop
2. Set up your [development environment](#tooling)
3. Meet your buddy

> Tip: ask questions early — nobody expects you to know everything.

## Tooling

| Tool | Purpose | Owner |
| --- | --- | --- |
| Git | Version control | Platform |
| Opal | AI assistant | Everyone |

\`\`\`ts
export function greet(name: string) {
  return \`Hello, \${name}!\`
}
\`\`\`

\`\`\`mermaid
flowchart LR
  A[Join] --> B[Setup] --> C[First PR]
\`\`\`

- [x] Read this guide
- [ ] Ship something
`,
      },
    },
    {
      id: "art_mmd",
      title: "Checkout flow",
      entry: "flow.mmd",
      files: {
        "flow.mmd": `sequenceDiagram
  participant U as User
  participant W as Web
  participant P as Payments
  U->>W: Add to cart
  U->>W: Checkout
  W->>P: Create intent
  P-->>W: client_secret
  W-->>U: Confirm`,
      },
    },
    {
      id: "art_svg",
      title: "Logo mark",
      entry: "logo.svg",
      files: {
        "logo.svg": `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#f59e0b"/><stop offset="1" stop-color="#c2410c"/></linearGradient></defs><circle cx="120" cy="120" r="96" fill="url(#g)"/><path d="M78 124l28 28 56-64" fill="none" stroke="#fff" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
      },
    },
    {
      id: "art_csv",
      title: "Q3 sales",
      entry: "sales.csv",
      files: {
        "sales.csv": `region,rep,deals,revenue,notes
North,"Smith, Jane",14,128000,"Closed ""Acme"" deal"
South,Lee,9,91000,
East,Garcia,21,203500,Top performer
West,Okafor,12,117250,New territory`,
      },
    },
    {
      id: "art_json",
      title: "API response",
      entry: "response.json",
      files: {
        "response.json": `{"user":{"id":42,"name":"Ada","roles":["admin","dev"],"active":true,"manager":null},"items":[{"sku":"A-1","qty":2},{"sku":"B-7","qty":1}],"total":129.5}`,
      },
    },
    {
      id: "art_py",
      title: "Fibonacci script",
      entry: "fib.py",
      files: {
        "fib.py": `def fib(n: int) -> list[int]:\n    """Return the first n Fibonacci numbers."""\n    out = [0, 1]\n    while len(out) < n:\n        out.append(out[-1] + out[-2])\n    return out[:n]\n\n\nif __name__ == "__main__":\n    print(fib(10))\n`,
      },
    },
    {
      id: "art_broken",
      title: "Broken component",
      entry: "App.jsx",
      files: {
        "App.jsx": `export default function App() {\n  const items = undefined\n  return <ul>{items.map((i) => <li>{i}</li>)}</ul>\n}\n`,
      },
    },
  ]
