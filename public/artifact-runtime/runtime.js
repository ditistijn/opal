/*
 * Opal artifact runtime — shared helpers for the renderer shells (react.html, markdown.html, …).
 * Classic script (no modules) so it also works in opaque-origin iframes and inlined into exports.
 *
 * File loading modes (see docs/ARTIFACTS.md):
 *   fetch     default inside the app: files come from the artifact:// origin at /<id>/<path>
 *   bridge    ?bridge=1 (plain-browser dev): the parent posts {type:"opal:files"} after "opal:ready"
 *   embedded  window.__OPAL_ARTIFACT__ = {id, entry, files, runtimeFiles} (exported .html bundles)
 *
 * Messages to the parent (window.parent.postMessage, target "*"; the parent checks event.source):
 *   {type:"opal:ready"}                         bridge mode: send me the files
 *   {type:"opal:rendered", kind}                first successful render
 *   {type:"opal:error", message, stack, phase}  transpile/runtime/load error
 *   {type:"opal:open-url", url}                 user clicked an external link
 */
;(function () {
  "use strict"
  var params = new URLSearchParams(location.search)
  var embedded = window.__OPAL_ARTIFACT__ || null
  var mode = embedded ? "embedded" : params.get("bridge") === "1" ? "bridge" : "fetch"
  var state = {
    id: embedded ? embedded.id : params.get("id") || "",
    entry: embedded ? embedded.entry : params.get("entry") || "",
    theme: params.get("theme") || (embedded && embedded.theme) || "light",
    files: embedded ? embedded.files : null,
    runtimeFiles: (embedded && embedded.runtimeFiles) || {},
  }
  var cache = Object.create(null)
  var blobURLs = Object.create(null)
  var bridgeWaiters = []
  var renderedSent = false
  var errored = false

  document.documentElement.setAttribute("data-theme", state.theme === "dark" ? "dark" : "light")

  function post(msg) {
    try {
      if (window.parent && window.parent !== window) window.parent.postMessage(msg, "*")
    } catch (e) {
      /* ignore */
    }
  }

  /** Normalizes "a/./b/../c" → "a/c"; returns null when the path escapes the root. */
  function normalize(path) {
    var out = []
    var parts = String(path).replace(/\\/g, "/").split("/")
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i]
      if (!p || p === ".") continue
      if (p === "..") {
        if (!out.length) return null
        out.pop()
        continue
      }
      out.push(p)
    }
    return out.join("/")
  }

  function dirname(path) {
    var i = path.lastIndexOf("/")
    return i < 0 ? "" : path.slice(0, i)
  }

  /** Resolves `spec` (relative or root-absolute) against the file `from`. */
  function resolve(from, spec) {
    if (spec.charAt(0) === "/") return normalize(spec)
    return normalize((dirname(from) ? dirname(from) + "/" : "") + spec)
  }

  function encodePath(path) {
    return path.split("/").map(encodeURIComponent).join("/")
  }

  function whenFiles() {
    if (state.files || mode === "fetch") return Promise.resolve()
    return new Promise(function (res) {
      bridgeWaiters.push(res)
    })
  }

  if (mode === "bridge") {
    window.addEventListener("message", function (event) {
      if (event.source !== window.parent) return
      var data = event.data
      if (!data || data.type !== "opal:files") return
      state.files = data.files || {}
      if (data.runtimeFiles) state.runtimeFiles = data.runtimeFiles
      if (data.id) state.id = data.id
      if (data.entry) state.entry = data.entry
      var w = bridgeWaiters
      bridgeWaiters = []
      w.forEach(function (f) {
        f()
      })
    })
    post({ type: "opal:ready" })
  }

  function notFound(path) {
    var err = new Error("Artifact file not found: " + path)
    err.code = "ENOENT"
    return err
  }

  /** Reads an artifact file as text. */
  function readFile(path) {
    var clean = normalize(path)
    if (clean === null) return Promise.reject(new Error("Path escapes the artifact: " + path))
    if (cache[clean] !== undefined) return Promise.resolve(cache[clean])
    return whenFiles().then(function () {
      if (state.files) {
        if (!Object.prototype.hasOwnProperty.call(state.files, clean)) throw notFound(clean)
        return (cache[clean] = state.files[clean])
      }
      return fetch("/" + encodeURIComponent(state.id) + "/" + encodePath(clean), { cache: "no-store" }).then(
        function (res) {
          if (!res.ok) throw notFound(clean)
          return res.text().then(function (t) {
            return (cache[clean] = t)
          })
        },
      )
    })
  }

  /** True when the artifact has `path` (fetch mode: probes with HEAD). */
  function hasFile(path) {
    var clean = normalize(path)
    if (clean === null) return Promise.resolve(false)
    if (cache[clean] !== undefined) return Promise.resolve(true)
    return whenFiles().then(function () {
      if (state.files) return Object.prototype.hasOwnProperty.call(state.files, clean)
      return fetch("/" + encodeURIComponent(state.id) + "/" + encodePath(clean), { method: "HEAD", cache: "no-store" })
        .then(function (r) {
          return r.ok
        })
        .catch(function () {
          return false
        })
    })
  }

  var MIME = {
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    css: "text/css",
    js: "text/javascript",
    json: "application/json",
    html: "text/html",
  }
  function mimeOf(path) {
    var ext = (path.split(".").pop() || "").toLowerCase()
    return MIME[ext] || "text/plain"
  }

  /** A URL the browser can load for an artifact file (for <img src>, <link href>, …). */
  function fileURL(path) {
    var clean = normalize(path)
    if (clean === null) return ""
    if (!state.files) return "/" + encodeURIComponent(state.id) + "/" + encodePath(clean)
    if (blobURLs[clean]) return blobURLs[clean]
    if (!Object.prototype.hasOwnProperty.call(state.files, clean)) return ""
    return (blobURLs[clean] = URL.createObjectURL(new Blob([state.files[clean]], { type: mimeOf(clean) })))
  }

  /** Reads a bundled runtime file (e.g. "shadcn/button.jsx"), relative to this shell. */
  function readRuntimeFile(rel) {
    if (state.runtimeFiles[rel] !== undefined) return Promise.resolve(state.runtimeFiles[rel])
    return fetch(new URL(rel, location.href).href, { cache: "no-store" })
      .catch(function () {
        throw new Error("Could not load runtime file " + rel)
      })
      .then(function (r) {
        if (!r.ok) throw new Error("Runtime file not found: " + rel)
        return r.text()
      })
  }

  function listFiles() {
    return whenFiles().then(function () {
      return state.files ? Object.keys(state.files) : null
    })
  }

  // ---------- errors ----------

  var overlay = null
  function showError(message, stack, phase) {
    if (!overlay) {
      overlay = document.createElement("div")
      overlay.className = "opal-error-overlay"
      overlay.setAttribute("role", "alert")
      document.body.appendChild(overlay)
    }
    overlay.innerHTML = ""
    var embedded = window.parent && window.parent !== window
    if (embedded) {
      // inside the Opal panel: the panel shows the message, details and "Ask Opal to fix"
      overlay.className = "opal-error-overlay opal-error-quiet"
      overlay.textContent = phase === "transpile" ? "This artifact could not be compiled." : "This artifact stopped because of an error."
      return
    }
    var title = document.createElement("div")
    title.className = "opal-error-title"
    title.textContent = phase === "transpile" ? "Could not compile artifact" : "Artifact error"
    var msg = document.createElement("pre")
    msg.className = "opal-error-message"
    msg.textContent = message
    overlay.appendChild(title)
    overlay.appendChild(msg)
    if (stack && stack !== message) {
      var st = document.createElement("pre")
      st.className = "opal-error-stack"
      st.textContent = stack
      overlay.appendChild(st)
    }
  }

  function reportError(err, phase) {
    var message = err && err.message ? String(err.message) : String(err)
    var stack = err && err.stack ? String(err.stack) : ""
    phase = phase || "runtime"
    errored = true
    if (document.body) showError(message, stack, phase)
    else
      document.addEventListener("DOMContentLoaded", function () {
        showError(message, stack, phase)
      })
    post({ type: "opal:error", message: message, stack: stack, phase: phase })
  }

  function rendered(kind) {
    if (renderedSent || errored) return
    renderedSent = true
    post({ type: "opal:rendered", kind: kind })
  }

  window.addEventListener("error", function (e) {
    // resource load errors (img/script) have no message; ignore them
    if (!e.message && !e.error) return
    reportError(e.error || new Error(e.message), "runtime")
  })
  window.addEventListener("unhandledrejection", function (e) {
    reportError(e.reason instanceof Error ? e.reason : new Error(String(e.reason)), "runtime")
  })

  // External links → parent opens them in the default browser.
  document.addEventListener(
    "click",
    function (e) {
      var a = e.target && e.target.closest ? e.target.closest("a[href]") : null
      if (!a) return
      var href = a.getAttribute("href") || ""
      if (href.charAt(0) === "#") return
      var url
      try {
        url = new URL(href, location.href)
      } catch (err) {
        return
      }
      if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:") {
        e.preventDefault()
        post({ type: "opal:open-url", url: url.href })
      }
    },
    true,
  )

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    })
  }

  window.OpalRuntime = {
    mode: mode,
    get id() {
      return state.id
    },
    get entry() {
      return state.entry
    },
    get theme() {
      return state.theme
    },
    whenFiles: whenFiles,
    readFile: readFile,
    hasFile: hasFile,
    fileURL: fileURL,
    readRuntimeFile: readRuntimeFile,
    listFiles: listFiles,
    normalize: normalize,
    resolve: resolve,
    dirname: dirname,
    reportError: reportError,
    rendered: rendered,
    post: post,
    escapeHTML: escapeHTML,
  }
})()
