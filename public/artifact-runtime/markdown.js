/* Markdown artifact shell: marked (GFM) + highlight.js + mermaid fenced blocks. */
;(function () {
  "use strict"
  var RT = window.OpalRuntime
  var MERMAID_URL = "https://cdn.jsdelivr.net/npm/mermaid@11.12.2/dist/mermaid.esm.min.mjs"

  function slug(text) {
    return String(text).toLowerCase().trim().replace(/<[^>]+>/g, "").replace(/[^\w\- ]+/g, "").replace(/\s+/g, "-")
  }

  var md = new window.Marked({ gfm: true, breaks: false })
  md.use({
    renderer: {
      code: function (token) {
        var lang = (token.lang || "").trim().split(/\s+/)[0].toLowerCase()
        var text = token.text
        if (lang === "mermaid") {
          return '<div class="mermaid-block" data-mermaid="' + RT.escapeHTML(text) + '"></div>'
        }
        var html
        try {
          html = lang && window.hljs.getLanguage(lang) ? window.hljs.highlight(text, { language: lang }).value : RT.escapeHTML(text)
        } catch (e) {
          html = RT.escapeHTML(text)
        }
        return '<pre><code class="hljs' + (lang ? " language-" + RT.escapeHTML(lang) : "") + '">' + html + "</code></pre>"
      },
      heading: function (token) {
        var inner = this.parser.parseInline(token.tokens)
        return "<h" + token.depth + ' id="' + slug(inner) + '">' + inner + "</h" + token.depth + ">"
      },
    },
  })

  function renderMermaid(root) {
    var blocks = root.querySelectorAll("[data-mermaid]")
    if (!blocks.length) return Promise.resolve()
    return import(MERMAID_URL).then(function (mod) {
      var mermaid = mod.default
      mermaid.initialize({ startOnLoad: false, theme: RT.theme === "dark" ? "dark" : "neutral", securityLevel: "strict", fontFamily: "inherit" })
      var i = 0
      return Array.prototype.reduce.call(
        blocks,
        function (p, el) {
          return p.then(function () {
            return mermaid
              .render("opal-mmd-" + i++, el.getAttribute("data-mermaid"))
              .then(function (out) {
                el.innerHTML = out.svg
              })
              .catch(function (err) {
                el.innerHTML = '<pre class="opal-error-message">Mermaid: ' + RT.escapeHTML(err && err.message ? err.message : String(err)) + "</pre>"
              })
          })
        },
        Promise.resolve(),
      )
    })
  }

  function fixRelative(root) {
    var entry = RT.normalize(RT.entry)
    root.querySelectorAll("img[src]").forEach(function (img) {
      var src = img.getAttribute("src")
      if (/^([a-z]+:|\/\/|#)/i.test(src)) return
      var p = RT.resolve(entry, src)
      if (p) img.setAttribute("src", RT.fileURL(p))
    })
    root.querySelectorAll('a[href^="#"]').forEach(function (a) {
      a.addEventListener("click", function (e) {
        var t = document.getElementById(decodeURIComponent(a.getAttribute("href").slice(1)))
        if (t) {
          e.preventDefault()
          t.scrollIntoView({ behavior: "smooth", block: "start" })
        }
      })
    })
  }

  RT.whenFiles()
    .then(function () {
      return RT.readFile(RT.entry)
    })
    .then(function (text) {
      // strip YAML front matter
      text = text.replace(/^---\n[\s\S]*?\n---\n/, "")
      var root = document.getElementById("doc")
      root.innerHTML = md.parse(text)
      var h1 = root.querySelector("h1")
      if (h1) document.title = h1.textContent
      fixRelative(root)
      return renderMermaid(root)
    })
    .then(function () {
      RT.rendered("markdown")
    })
    .catch(function (err) {
      RT.reportError(err, "load")
    })
})()
