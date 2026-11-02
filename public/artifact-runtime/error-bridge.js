/*
 * Opt-in error bridge for HTML artifacts. Add as the FIRST script in <head>:
 *   <script src="/_runtime/error-bridge.js"></script>
 * Reports uncaught errors / unhandled rejections / console.error to the Opal artifact panel (which
 * shows them with an "Ask Opal to fix" button), signals when the page has loaded, and routes external
 * links to the default browser. Harmless when the page is opened outside Opal.
 */
;(function () {
  "use strict"
  if (window.__opalErrorBridge) return
  window.__opalErrorBridge = true
  function post(msg) {
    try {
      if (window.parent && window.parent !== window) window.parent.postMessage(msg, "*")
    } catch (e) {}
  }
  function report(err, phase) {
    var message = err && err.message ? String(err.message) : String(err)
    post({ type: "opal:error", message: message, stack: err && err.stack ? String(err.stack) : "", phase: phase || "runtime" })
  }
  window.addEventListener("error", function (e) {
    if (!e.message && !e.error) return
    report(e.error || new Error(e.message + (e.filename ? " (" + e.filename + ":" + e.lineno + ")" : "")))
  })
  window.addEventListener("unhandledrejection", function (e) {
    report(e.reason instanceof Error ? e.reason : new Error(String(e.reason)))
  })
  window.addEventListener("load", function () {
    post({ type: "opal:rendered", kind: "html" })
  })
  document.addEventListener(
    "click",
    function (e) {
      var a = e.target && e.target.closest ? e.target.closest("a[href]") : null
      if (!a) return
      var url
      try {
        url = new URL(a.getAttribute("href"), location.href)
      } catch (err) {
        return
      }
      if ((url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:") && url.origin !== location.origin) {
        e.preventDefault()
        post({ type: "opal:open-url", url: url.href })
      }
    },
    true,
  )
})()
