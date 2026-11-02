import { describe, expect, it } from "vitest"
import {
  buildFilesZip,
  buildStandaloneHTML,
  crc32,
  createZip,
  exportBaseName,
  inlineHTMLArtifact,
  jsonForScript,
  type RuntimeLoader,
} from "@/lib/artifacts"

const content = (entry: string, files: Record<string, string>, title = "My Artifact") =>
  ({ info: { id: "art_t", title, entry }, files }) as unknown as Parameters<typeof buildStandaloneHTML>[0]

describe("inlineHTMLArtifact", () => {
  it("inlines local stylesheets, scripts and images; keeps remote ones", () => {
    const html = inlineHTMLArtifact(
      content("index.html", {
        "index.html":
          '<html><head><script src="/_runtime/error-bridge.js"></script><link rel="stylesheet" href="css/site.css"><link rel="stylesheet" href="https://cdn.example/x.css"></head>' +
          '<body><img src="./logo.svg"><script src="js/app.js"></script><script src="https://cdn.example/lib.js"></script></body></html>',
        "css/site.css": "body{color:red}",
        "js/app.js": 'console.log("</script>")',
        "logo.svg": "<svg/>",
      }),
    )
    expect(html).not.toContain("error-bridge")
    expect(html).toContain("<style>body{color:red}</style>")
    expect(html).toContain('href="https://cdn.example/x.css"')
    expect(html).toContain('<script>console.log("<\\/script>")</script>')
    expect(html).toContain('src="https://cdn.example/lib.js"')
    expect(html).toContain(`src="data:image/svg+xml;base64,${btoa("<svg/>")}"`)
  })

  it("resolves references relative to a nested entry", () => {
    const html = inlineHTMLArtifact(
      content("pages/a.html", { "pages/a.html": '<link rel="stylesheet" href="../s.css">', "s.css": "p{}" }),
    )
    expect(html).toBe("<style>p{}</style>")
  })
})

describe("buildStandaloneHTML", () => {
  const shell =
    '<!doctype html><html><head><title>Artifact</title><link rel="stylesheet" href="./runtime.css" /><script src="./vendor/sucrase.js"></script><script src="./runtime.js"></script></head><body><script src="./react.js"></script></body></html>'
  const runtime: Record<string, string> = {
    "react.html": shell,
    "runtime.css": ":root{}",
    "vendor/sucrase.js": "window.sucrase={}",
    "runtime.js": "window.OpalRuntime={}",
    "react.js": "/*react*/",
    "shadcn/utils.js": "export const cn=()=>''",
  }
  const load: RuntimeLoader = async (rel) => runtime[rel] ?? `/*${rel}*/`

  it("embeds the shell, its assets and the files payload", async () => {
    const html = await buildStandaloneHTML(
      content(
        "App.tsx",
        { "App.tsx": 'import { Button } from "@/components/ui/button"\nconst s = "</script>"' },
        "Chart <1>",
      ),
      "react",
      { load },
    )
    expect(html).toContain("<title>Chart &lt;1&gt;</title>")
    expect(html).toContain("<style>:root{}</style>")
    expect(html).toContain("<script>window.sucrase={}</script>")
    expect(html).toContain("<script>/*react*/</script>")
    expect(html).not.toContain('src="./')
    const boot = html.match(/<script>window\.__OPAL_ARTIFACT__=(.*?)<\/script>/)
    expect(boot).not.toBeNull()
    expect(boot![1]).not.toContain("</script>")
    const payload = JSON.parse(boot![1])
    expect(payload.entry).toBe("App.tsx")
    expect(payload.files["App.tsx"]).toContain("</script>")
    expect(payload.runtimeFiles["shadcn/utils.js"]).toBe("export const cn=()=>''")
    // the payload must come before the runtime script
    expect(html.indexOf("__OPAL_ARTIFACT__")).toBeLessThan(html.indexOf("window.OpalRuntime"))
  })

  it("returns inlined HTML for html artifacts", async () => {
    const html = await buildStandaloneHTML(content("index.html", { "index.html": "<p>hi</p>" }), "html", {
      load,
    })
    expect(html).toBe("<p>hi</p>")
  })
})

describe("helpers", () => {
  it("sanitizes export names", () => {
    expect(exportBaseName("Sales / Q3: report?")).toBe("Sales Q3 report")
    expect(exportBaseName("...")).toBe("artifact")
    expect(exportBaseName("Übersicht 2026")).toBe("Übersicht 2026")
  })
  it("escapes JSON for inline scripts", () => {
    expect(jsonForScript({ a: "</script><!--" })).toBe('{"a":"\\u003c/script>\\u003c!--"}')
    expect(JSON.parse(jsonForScript({ a: "</script>\u2028" })).a).toBe("</script>\u2028")
  })
})

describe("zip", () => {
  it("computes CRC-32", () => {
    expect(crc32(new TextEncoder().encode("hello"))).toBe(0x3610a686)
    expect(crc32(new Uint8Array())).toBe(0)
  })

  it("writes a well-formed STORE archive", () => {
    const zip = createZip([
      { path: "a.txt", data: "hello" },
      { path: "dir/b.txt", data: "wörld" },
    ])
    const view = new DataView(zip.buffer)
    expect(view.getUint32(0, true)).toBe(0x04034b50)
    const eocd = zip.length - 22
    expect(view.getUint32(eocd, true)).toBe(0x06054b50)
    expect(view.getUint16(eocd + 10, true)).toBe(2)
    const cdOffset = view.getUint32(eocd + 16, true)
    expect(view.getUint32(cdOffset, true)).toBe(0x02014b50)
    expect(view.getUint32(cdOffset + 16, true)).toBe(0x3610a686)
    const text = new TextDecoder().decode(zip)
    expect(text).toContain("a.txt")
    expect(text).toContain("dir/b.txt")
    expect(text).toContain("wörld")
  })

  it("puts artifact files under a folder named after the title", () => {
    const zip = buildFilesZip({
      info: { title: "My App" },
      files: { "index.html": "x", "../evil": "y", "js/a.js": "z" },
    })
    const text = new TextDecoder().decode(zip)
    expect(text).toContain("My App/index.html")
    expect(text).toContain("My App/js/a.js")
    expect(text).not.toContain("evil")
  })
})
