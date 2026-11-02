/*
 * React artifact shell: transpiles the TSX/JSX entry (and its relative imports) in the browser with
 * Sucrase, turns each module into a blob: URL, and mounts the entry's default export into #root.
 * Classic script that uses dynamic import(), so it works in opaque-origin iframes and exports.
 */
;(function () {
  "use strict"
  var RT = window.OpalRuntime

  /** Pinned versions for bare imports (esm.sh). Unknown packages resolve to esm.sh latest. */
  var PINNED = {
    recharts: "2.15.4",
    "lucide-react": "0.575.0",
    d3: "7.9.0",
    three: "0.170.0",
    "framer-motion": "11.18.2",
    motion: "11.18.2",
    lodash: "4.17.21",
    "lodash-es": "4.17.21",
    papaparse: "5.5.3",
    mathjs: "14.5.2",
    "chart.js": "4.5.0",
    "react-chartjs-2": "5.3.0",
    "date-fns": "4.1.0",
    clsx: "2.1.1",
    "tailwind-merge": "3.3.1",
    "class-variance-authority": "0.7.1",
    zustand: "5.0.6",
    tone: "15.1.22",
    "react-router-dom": "7.6.3",
    "@react-three/fiber": "9.2.0",
    "@react-three/drei": "10.5.0",
    "react-markdown": "10.1.0",
    "remark-gfm": "4.0.1",
    xlsx: "0.18.5",
    "canvas-confetti": "1.9.3",
    "react-icons": "5.5.0",
    "@headlessui/react": "2.2.4",
    plotly: "1.0.6",
    "plotly.js-dist-min": "3.0.1",
    "react-plotly.js": "2.6.0",
    "victory": "37.3.6",
    "uuid": "11.1.0",
    "immer": "10.1.1",
    "@tanstack/react-query": "5.81.5",
    "chroma-js": "3.1.2",
  }
  /** Bare specifiers left alone because the import map in react.html provides them. */
  var MAPPED = { react: 1, "react/jsx-runtime": 1, "react/jsx-dev-runtime": 1, "react-dom": 1, "react-dom/client": 1 }

  /** shadcn/ui-compatible components bundled in ./shadcn (importable as "@/components/ui/<name>"). */
  var UI = ["alert", "badge", "button", "card", "checkbox", "input", "label", "progress", "select", "separator", "slider", "switch", "table", "tabs", "textarea"]
  var CODE_EXT = /\.(tsx|ts|jsx|js|mjs|cjs|mts|cts)$/i
  var PROBE = [".tsx", ".ts", ".jsx", ".js", ".mjs", "/index.tsx", "/index.ts", "/index.jsx", "/index.js"]
  var modules = Object.create(null) // key → Promise<blobURL>

  function packageURL(spec) {
    var parts = spec.split("/")
    var name = spec.charAt(0) === "@" ? parts.slice(0, 2).join("/") : parts[0]
    var sub = spec.slice(name.length) // "" or "/x/y"
    var version = PINNED[name]
    return "https://esm.sh/" + name + (version ? "@" + version : "") + sub + "?external=react,react-dom"
  }

  function transpile(code, path) {
    var ext = (path.match(/\.([a-z]+)$/i) || [, "js"])[1].toLowerCase()
    var transforms = ext === "ts" || ext === "mts" || ext === "cts" ? ["typescript"] : ext === "tsx" ? ["typescript", "jsx"] : ["jsx"]
    try {
      return window.sucrase.transform(code, {
        transforms: transforms,
        jsxRuntime: "automatic",
        production: true,
        disableESTransforms: true,
        filePath: path,
      }).code
    } catch (err) {
      var e = new Error(path + ": " + (err && err.message ? err.message : String(err)))
      e.stack = ""
      e.phase = "transpile"
      throw e
    }
  }

  function blob(code, type) {
    return URL.createObjectURL(new Blob([code], { type: type || "text/javascript" }))
  }

  /** Resolve a relative/absolute/alias specifier to an artifact file path (probing extensions). */
  function resolveArtifactPath(from, spec) {
    var candidates = []
    if (spec.indexOf("@/") === 0) {
      var rest = spec.slice(2)
      candidates.push(rest, "src/" + rest)
    } else {
      var base = RT.resolve(from, spec)
      if (base === null) return Promise.reject(new Error(from + ": import escapes the artifact: " + spec))
      candidates.push(base)
    }
    var all = []
    candidates.forEach(function (c) {
      all.push(c)
      if (!/\.[a-z0-9]+$/i.test(c) || !CODE_EXT.test(c)) PROBE.forEach((s) => all.push(c + s))
    })
    var i = 0
    function next() {
      if (i >= all.length) return Promise.reject(new Error(from + ": cannot resolve import \"" + spec + "\""))
      var c = all[i++]
      return RT.hasFile(c).then(function (ok) {
        return ok ? c : next()
      })
    }
    return next()
  }

  function rewriteImports(code, from, isRuntime, chain) {
    var re = /(\b(?:import|export)\s*(?:[^'"`;]*?\s*from\s*)?)(["'])([^"'\n]+)\2|(\bimport\s*\(\s*)(["'])([^"'\n]+)\5(\s*\))/g
    var jobs = []
    code.replace(re, function (m, a1, q1, s1, b1, q2, s2) {
      jobs.push(s1 || s2)
      return m
    })
    var unique = jobs.filter(function (s, i) {
      return jobs.indexOf(s) === i
    })
    return Promise.all(
      unique.map(function (spec) {
        return resolveSpecifier(spec, from, isRuntime, chain).then(function (url) {
          return [spec, url]
        })
      }),
    ).then(function (pairs) {
      var map = Object.create(null)
      pairs.forEach(function (p) {
        map[p[0]] = p[1]
      })
      return code.replace(re, function (m, a1, q1, s1, b1, q2, s2, b2) {
        if (s1) return a1 + q1 + map[s1] + q1
        return b1 + q2 + map[s2] + q2 + b2
      })
    })
  }

  function resolveSpecifier(spec, from, isRuntime, chain) {
    if (MAPPED[spec] || /^(https?:|data:|blob:)/.test(spec)) return Promise.resolve(spec)
    if (spec === "@/lib/utils") return buildRuntime("shadcn/utils.js", chain)
    var ui = spec.match(/^@\/components\/ui\/([a-z0-9-]+)$/)
    if (ui) {
      return RT.hasFile("components/ui/" + ui[1] + ".tsx").then(function (own) {
        // the artifact may ship its own component; prefer it
        if (own) return buildArtifact("components/ui/" + ui[1] + ".tsx", chain)
        if (UI.indexOf(ui[1]) < 0)
          throw new Error(
            from + ': "' + spec + '" is not available in the artifact runtime. Available: ' + UI.join(", ") +
              ". Build the component inline with Tailwind classes instead.",
          )
        return buildRuntime("shadcn/" + ui[1] + ".jsx", chain)
      })
    }
    if (isRuntime && spec.charAt(0) === ".") return buildRuntime(RT.resolve(from, spec), chain)
    if (spec.charAt(0) === "." || spec.charAt(0) === "/" || spec.indexOf("@/") === 0) {
      return resolveArtifactPath(from, spec).then(function (p) {
        return buildArtifact(p, chain)
      })
    }
    return Promise.resolve(packageURL(spec))
  }

  /** `chain` = keys of the importing ancestors (blob URLs cannot express import cycles). */
  function moduleFor(key, path, load, isRuntime, chain) {
    chain = chain || []
    if (chain.indexOf(key) >= 0) {
      return Promise.reject(new Error("Circular import is not supported: " + chain.concat(key).map((k) => k.slice(2)).join(" → ")))
    }
    if (modules[key]) return modules[key]
    var next = chain.concat(key)
    modules[key] = load()
      .then(function (source) {
        var lower = path.toLowerCase()
        if (/\.css$/.test(lower)) {
          var style = document.createElement("style")
          style.setAttribute("data-artifact-file", path)
          style.textContent = source
          document.head.appendChild(style)
          return blob("export default {}")
        }
        if (/\.json$/.test(lower)) return blob("export default " + JSON.stringify(JSON.parse(source)))
        if (/\.(svg|png|jpe?g|gif|webp)$/.test(lower))
          return blob("export default " + JSON.stringify(RT.fileURL(path)))
        if (!CODE_EXT.test(lower)) return blob("export default " + JSON.stringify(source))
        return rewriteImports(transpile(source, path), path, isRuntime, next).then(function (code) {
          return blob(code + "\n//# sourceURL=" + (isRuntime ? "opal-runtime/" : "artifact/") + path)
        })
      })
    return modules[key]
  }

  function buildArtifact(path, chain) {
    return moduleFor(
      "a:" + path,
      path,
      function () {
        return RT.readFile(path)
      },
      false,
      chain,
    )
  }
  function buildRuntime(rel, chain) {
    return moduleFor(
      "r:" + rel,
      rel,
      function () {
        return RT.readRuntimeFile(rel)
      },
      true,
      chain,
    )
  }

  function pickComponent(mod) {
    if (typeof mod.default === "function" || (mod.default && typeof mod.default === "object" && mod.default.$$typeof))
      return mod.default
    var names = Object.keys(mod).filter(function (k) {
      return /^[A-Z]/.test(k) && typeof mod[k] === "function"
    })
    return names.length ? mod[names[0]] : null
  }

  function main() {
    var rootEl = document.getElementById("root")
    return RT.whenFiles()
      .then(function () {
        if (!RT.entry) throw new Error("No entry file given")
        return Promise.all([
          buildArtifact(RT.normalize(RT.entry)),
          import("react"),
          import("react-dom/client"),
        ])
      })
      .then(function (r) {
        var entryURL = r[0]
        var React = r[1]
        var ReactDOMClient = r[2]
        return import(entryURL).then(function (mod) {
          var Comp = pickComponent(mod)
          if (!Comp) {
            if (rootEl.childNodes.length) return RT.rendered("react")
            throw new Error(RT.entry + " has no default export. Export the root component: export default function App() { … }")
          }
          var root = ReactDOMClient.createRoot(rootEl, {
            onUncaughtError: function (error) {
              RT.reportError(error, "runtime")
            },
          })
          root.render(React.createElement(Comp))
          requestAnimationFrame(function () {
            requestAnimationFrame(function () {
              RT.rendered("react")
            })
          })
        })
      })
      .catch(function (err) {
        var msg = err && err.message ? err.message : String(err)
        if (/Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(msg)) {
          err = new Error(msg + "\n\nA package could not be loaded from esm.sh — check the import name and your network connection.")
        }
        RT.reportError(err, err && err.phase ? err.phase : "runtime")
      })
  }

  main()
})()
