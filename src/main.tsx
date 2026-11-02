import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import { isTauri } from "./lib/utils"
import "./index.css"

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// Acceptance smoke harness (inert unless the app was started with OPAL_SMOKE; see scripts/smoke-mac.sh).
if (isTauri()) void import("./lib/smoke").then((smoke) => smoke.startSmoke())
