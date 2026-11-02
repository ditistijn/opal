/**
 * Scripted "inline widgets" tour for the mock runtime (docs/INLINE-WIDGETS.md §3): one reply that mixes
 * prose with a `chart` (dataset tabs), two `widget`s, a `mermaid` diagram and an `svg`. Prose streams at
 * the normal pace; fence bodies stream in larger chunks so the demo does not crawl. Chunks always split
 * on whitespace, so a fence marker never arrives in pieces.
 */
import type { Step } from "./replies"

const F = "```"

const CHART = {
  type: "line",
  title: "Rental business, 2025",
  subtitle: "Illustrative sample data",
  x: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  datasets: [
    {
      label: "Revenue",
      format: "currency:EUR",
      series: [
        {
          name: "2025",
          data: [14200, 15800, 21400, 26900, 34800, 41200, 45600, 43900, 36100, 27400, 18900, 22300],
        },
        {
          name: "2024",
          data: [11800, 12900, 17600, 22100, 29400, 35800, 39900, 38200, 30500, 22800, 15600, 18100],
        },
      ],
    },
    {
      label: "Orders",
      type: "bar",
      format: "number",
      series: [{ name: "Orders", data: [61, 68, 92, 118, 151, 178, 196, 189, 157, 119, 82, 97] }],
    },
    {
      label: "Conversion",
      type: "area",
      format: "percent",
      series: [
        {
          name: "Quote → booking",
          data: [0.21, 0.23, 0.26, 0.29, 0.32, 0.34, 0.36, 0.35, 0.31, 0.27, 0.22, 0.25],
        },
      ],
    },
  ],
  note: "Revenue compares 2025 with 2024; conversion is the share of quotes that became a booking.",
}

const FLEET_SIMULATOR = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  .wrap { padding: 16px 18px; display: grid; gap: 18px; }
  .controls { display: grid; gap: 12px; }
  label { display: grid; grid-template-columns: 170px 1fr 84px; align-items: center; gap: 14px; font-size: 14px; color: var(--fg-secondary); }
  label output { text-align: right; font-weight: 600; color: var(--fg); font-variant-numeric: tabular-nums; }
  input[type="range"] { width: 100%; accent-color: var(--accent); }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
  .stat { background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; }
  .stat span { display: block; font-size: 12px; color: var(--fg-muted); }
  .stat strong { display: block; margin-top: 4px; font-size: 22px; font-variant-numeric: tabular-nums; }
  .pos { color: var(--success); }
  .neg { color: var(--danger); }
  .bar { height: 8px; border-radius: 99px; background: var(--bg-muted); overflow: hidden; }
  .bar i { display: block; height: 100%; width: 0; background: var(--accent); transition: width 0.2s; }
  .foot { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px; font-size: 13px; color: var(--fg-muted); }
  @media (max-width: 520px) {
    label { grid-template-columns: 1fr 72px; }
    label input { grid-column: 1 / -1; grid-row: 2; }
  }
</style>
</head>
<body>
<div class="wrap">
  <div class="controls">
    <label>Number of radios <input id="radios" type="range" min="4" max="80" step="2" value="24"><output id="radiosOut"></output></label>
    <label>Price per set / week <input id="price" type="range" min="10" max="60" step="1" value="29"><output id="priceOut"></output></label>
    <label>Weeks rented / month <input id="weeks" type="range" min="0.5" max="4" step="0.25" value="2.25"><output id="weeksOut"></output></label>
    <label>Purchase cost per set <input id="cost" type="range" min="80" max="600" step="10" value="240"><output id="costOut"></output></label>
  </div>
  <div class="stats">
    <div class="stat"><span>Monthly gross revenue</span><strong id="revenue"></strong></div>
    <div class="stat"><span>CAPEX (fleet purchase)</span><strong id="capex"></strong></div>
    <div class="stat"><span>Year-1 revenue − CAPEX</span><strong id="net"></strong></div>
    <div class="stat"><span>Recovery time</span><strong id="months"></strong></div>
  </div>
  <div class="bar" aria-hidden="true"><i id="progress"></i></div>
  <div class="foot"><span id="hint"></span><button id="ask" type="button">Turn this into a business case</button></div>
</div>
<script>
  var $ = function (id) { return document.getElementById(id) }
  var eur = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })
  function values() {
    return { radios: +$("radios").value, price: +$("price").value, weeks: +$("weeks").value, cost: +$("cost").value }
  }
  function update() {
    var v = values()
    var revenue = v.radios * v.price * v.weeks
    var capex = v.radios * v.cost
    var net = revenue * 12 - capex
    var months = capex / revenue
    var cover = (revenue * 12) / capex
    $("radiosOut").textContent = v.radios
    $("priceOut").textContent = eur.format(v.price)
    $("weeksOut").textContent = v.weeks + " wk"
    $("costOut").textContent = eur.format(v.cost)
    $("revenue").textContent = eur.format(revenue)
    $("capex").textContent = eur.format(capex)
    $("net").textContent = (net >= 0 ? "+" : "−") + eur.format(Math.abs(net))
    $("net").className = net >= 0 ? "pos" : "neg"
    $("months").textContent = months.toFixed(1) + " months"
    $("progress").style.width = Math.min(100, cover * 100) + "%"
    $("hint").textContent = cover >= 1
      ? "Year-1 revenue covers the fleet " + cover.toFixed(1) + "×."
      : "Year 1 covers " + Math.round(cover * 100) + "% of the fleet cost — raise utilisation or price."
  }
  document.querySelectorAll("input").forEach(function (el) { el.addEventListener("input", update) })
  $("ask").addEventListener("click", function () {
    var v = values()
    window.opal.sendPrompt("Write a short business case for a rental fleet of " + v.radios + " radios at " +
      eur.format(v.price) + " per set per week, rented " + v.weeks + " weeks a month, bought at " +
      eur.format(v.cost) + " per set.")
  })
  update()
</script>
</body>
</html>`

const DECISION_TREE = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  .wrap { padding: 16px 18px; display: grid; gap: 16px; }
  fieldset { border: 0; margin: 0; padding: 0; }
  legend { padding: 0; margin-bottom: 8px; font-size: 13px; font-weight: 600; color: var(--fg-secondary); }
  .opts { display: flex; flex-wrap: wrap; gap: 8px; }
  .opts label { display: flex; align-items: center; gap: 8px; padding: 7px 12px; border: 1px solid var(--border); border-radius: 999px; background: var(--bg-elevated); font-size: 14px; cursor: pointer; }
  .opts label:has(input:checked) { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
  .opts input { margin: 0; accent-color: var(--accent); }
  .rec { padding: 14px 16px; border: 1px solid var(--border); border-left: 4px solid var(--accent); border-radius: 12px; background: var(--bg-elevated); }
  .rec small { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--fg-muted); }
  .rec h3 { margin: 4px 0 6px; font-size: 18px; color: var(--fg); }
  .rec p { margin: 0 0 12px; font-size: 14px; line-height: 1.5; color: var(--fg-secondary); }
</style>
</head>
<body>
<div class="wrap">
  <fieldset>
    <legend>How often do you need radios?</legend>
    <div class="opts">
      <label><input type="radio" name="freq" value="0" checked> One or two events a year</label>
      <label><input type="radio" name="freq" value="1"> About once a month</label>
      <label><input type="radio" name="freq" value="2"> Every week</label>
    </div>
  </fieldset>
  <fieldset>
    <legend>How many sets per event?</legend>
    <div class="opts">
      <label><input type="radio" name="size" value="0"> Fewer than 10</label>
      <label><input type="radio" name="size" value="1" checked> 10 to 30</label>
      <label><input type="radio" name="size" value="2"> More than 30</label>
    </div>
  </fieldset>
  <div class="rec" id="rec">
    <small>Recommendation</small>
    <h3 id="title"></h3>
    <p id="why"></p>
    <button id="ask" type="button">Ask a follow-up</button>
  </div>
</div>
<script>
  var tone = { rent: "var(--accent)", mix: "var(--warning)", buy: "var(--success)" }
  var advice = [
    [
      ["rent", "Rent", "At one or two events a year, rented sets cost far less than radios that sit in a drawer, and they arrive charged."],
      ["rent", "Rent", "Renting 10 to 30 sets a couple of times a year avoids a purchase of several thousand euros plus chargers, spares and repairs."],
      ["rent", "Rent with a framework deal", "Large one-off events are what rental fleets are for. Agree a fixed rate and delivery window well in advance."]
    ],
    [
      ["rent", "Rent, review in a year", "Monthly use of a few radios sits close to break-even. Rent for now and track how many weeks you actually use them."],
      ["mix", "Long-term rental", "Regular mid-size use favours a long-term contract: a fixed monthly price with maintenance and replacements included."],
      ["mix", "Buy a core fleet, rent the peaks", "Own the sets you use every month and rent extra radios for the busiest events."]
    ],
    [
      ["buy", "Buy", "Weekly use pays back a small fleet within months. Buy licence-free PMR446 radios and keep one spare."],
      ["buy", "Buy", "At weekly use, 10 to 30 sets usually recover their cost within the first year. Budget for batteries and a multi-charger."],
      ["buy", "Buy and manage the fleet", "Own the fleet, label every set, and plan battery replacements every two to three years."]
    ]
  ]
  function picked(name) { return +document.querySelector("input[name=" + name + "]:checked").value }
  function update() {
    var a = advice[picked("freq")][picked("size")]
    document.getElementById("rec").style.borderLeftColor = tone[a[0]]
    document.getElementById("title").textContent = a[1]
    document.getElementById("why").textContent = a[2]
  }
  document.querySelectorAll("input").forEach(function (el) { el.addEventListener("change", update) })
  document.getElementById("ask").addEventListener("click", function () {
    window.opal.sendPrompt("Why is \\"" + document.getElementById("title").textContent + "\\" the best option for my situation?")
  })
  update()
</script>
</body>
</html>`

const MERMAID = `flowchart LR
  C([Customer]) --> W["Website & quote form"]
  W --> A[Booking API]
  A --> I[(Inventory)]
  A --> P[Payment provider]
  A --> E[Confirmation email]
  A --> S[Warehouse picking list]
  S --> K[Courier]
  K -->|delivers radios| C
  C -->|returns after the event| R["Check-in & charging"]
  R --> I`

const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 96" role="img" aria-label="Relay Rentals logo">
  <rect x="8" y="8" width="80" height="80" rx="20" fill="#D97757"/>
  <rect x="36" y="30" width="24" height="46" rx="6" fill="#FFFFFF"/>
  <rect x="44" y="16" width="5" height="16" rx="2.5" fill="#FFFFFF"/>
  <circle cx="48" cy="44" r="5" fill="#D97757"/>
  <rect x="41" y="56" width="14" height="3" rx="1.5" fill="#D97757"/>
  <rect x="41" y="63" width="14" height="3" rx="1.5" fill="#D97757"/>
  <path d="M66 34a14 14 0 0 1 0 20M72 28a22 22 0 0 1 0 32" fill="none" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round"/>
  <text x="104" y="48" font-family="-apple-system, system-ui, sans-serif" font-size="26" font-weight="700" fill="#D97757">Relay</text>
  <text x="104" y="74" font-family="-apple-system, system-ui, sans-serif" font-size="18" font-weight="500" fill="#87867F">Rentals</text>
</svg>`

/** Fence bodies stream this many words per tick. */
const CODE_WORDS = 14

function fence(info: string, body: string): Step {
  return { kind: "text", text: `${F}${info}\n${body}\n${F}\n\n`, words: CODE_WORDS }
}

function prose(text: string): Step {
  return { kind: "text", text }
}

export const INLINE_TOUR_STEPS: readonly Step[] = [
  {
    kind: "reasoning",
    text: "The user wants to see what can render inside a reply. I'll show each inline type once with one consistent example — a small radio rental business: a chart with dataset tabs, a calculator, a decision helper, an architecture diagram and a logo.",
  },
  prose(
    "Here's a quick tour of what I can draw **right inside a reply** — no side panel needed. Everything below is live: hover the chart, switch its tabs, drag the sliders and click the options. The running example is a small business that rents out walkie-talkies for events.\n\n## 1. Interactive chart\n\nMonthly results for 2025. Use the tabs to switch between revenue, orders and conversion; hover a point for the exact value.\n\n",
  ),
  fence("chart", JSON.stringify(CHART, null, 2)),
  prose(
    "Revenue peaks in July at **€45.6k**, about 14% above July 2024, and conversion follows the same summer curve.\n\n## 2. Interactive calculator\n\nWhat does a rental fleet earn, and how fast does it pay for itself? Drag the sliders — the outputs update as you go.\n\n",
  ),
  fence('widget title="Rental fleet simulator"', FLEET_SIMULATOR),
  prose(
    "With the defaults (24 radios at €29 per set per week, rented 2.25 weeks a month) the fleet earns back its purchase price in under four months.\n\n## 3. Decision tree\n\nShould a customer rent or buy? Pick the two answers that fit and the recommendation updates.\n\n",
  ),
  fence('widget title="Rent or buy?"', DECISION_TREE),
  prose(
    "## 4. Architecture\n\nHow a booking moves through the business, from quote to the radios coming back:\n\n",
  ),
  fence("mermaid", MERMAID),
  prose("## 5. Logo\n\nAnd a small SVG mark for the brand:\n\n"),
  fence('svg title="Relay Rentals logo"', LOGO),
  prose(
    'That\'s the toolkit: **charts** for numbers, **widgets** for anything you want to play with, **Mermaid** for structure and **SVG** for small graphics. Ask a normal question — "chart my monthly expenses" or "how much would I save if…" — and I\'ll draw one inline when it helps. For something you want to keep, export or keep refining, I\'ll build an artifact in the panel instead.',
  ),
]
