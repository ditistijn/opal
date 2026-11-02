/**
 * ` ```svg ` blocks: sanitised and shown as <img src="data:image/svg+xml,…">. In an <img> the SVG can
 * neither run scripts nor load external resources; sanitising on top of that keeps the source we hand
 * out (and the Source view) honest and rejects anything that is not a single SVG document.
 */
import { memo } from "react"

export const MAX_SVG_CHARS = 500_000
const SVG_NS = "http://www.w3.org/2000/svg"
const XLINK_NS = "http://www.w3.org/1999/xlink"

const FORBIDDEN_TAGS = new Set([
  "script",
  "foreignobject",
  "iframe",
  "embed",
  "object",
  "audio",
  "video",
  "canvas",
  "handler",
  "listener",
])

export type SanitizedSvg =
  { ok: true; dataURL: string; svg: string; width?: number; height?: number } | { ok: false; error: string }

/** Only same-document fragments and embedded raster images may be referenced. */
function safeRef(value: string): boolean {
  const v = value.trim()
  return v.startsWith("#") || /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(v)
}

/** Drops url(...) references that are not local fragments, and @import rules. */
function cleanCSS(css: string): string {
  return css
    .replace(/@import[^;]*;?/gi, "")
    .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (m, _q: string, ref: string) =>
      ref.startsWith("#") ? m : "none",
    )
    .replace(/expression\s*\(/gi, "")
}

function lengthAttr(el: Element, name: string): number | undefined {
  const raw = el.getAttribute(name)
  if (!raw) return undefined
  const m = /^\s*([\d.]+)\s*(px)?\s*$/.exec(raw)
  if (!m) return undefined
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : undefined
}

export function sanitizeSvg(source: string): SanitizedSvg {
  const text = source.trim()
  if (!text) return { ok: false, error: "the block is empty" }
  if (text.length > MAX_SVG_CHARS) return { ok: false, error: "the SVG is too large" }
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    return { ok: false, error: "DOCTYPE and entity declarations are not allowed" }
  // models often omit the namespace declarations; add them to the root so the image renders
  let xml = text
  const openTag = /<svg\b[^>]*>/.exec(xml)?.[0] ?? ""
  if (openTag && !/\sxmlns\s*=/.test(openTag)) xml = xml.replace(/<svg\b/, `<svg xmlns="${SVG_NS}"`)
  if (/\bxlink:/.test(xml) && !/xmlns:xlink\s*=/.test(xml))
    xml = xml.replace(/<svg\b/, `<svg xmlns:xlink="${XLINK_NS}"`)
  const doc = new DOMParser().parseFromString(xml, "image/svg+xml")
  const root = doc.documentElement
  if (!root || doc.getElementsByTagName("parsererror").length > 0)
    return { ok: false, error: "the SVG is not well-formed XML" }
  if (root.localName !== "svg" || root.namespaceURI !== SVG_NS)
    return { ok: false, error: `the root element is <${root.localName}>, not an SVG <svg>` }

  const all = [root, ...Array.from(root.getElementsByTagName("*"))]
  for (const el of all) {
    if (el !== root && FORBIDDEN_TAGS.has(el.localName.toLowerCase())) {
      el.remove()
      continue
    }
    if (el.localName.toLowerCase() === "style" && el.textContent) el.textContent = cleanCSS(el.textContent)
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      if (name.startsWith("on")) el.removeAttributeNode(attr)
      else if (
        name === "href" ||
        name === "xlink:href" ||
        name.endsWith(":href") ||
        attr.namespaceURI === XLINK_NS
      ) {
        if (!safeRef(attr.value)) el.removeAttributeNode(attr)
      } else if (name === "style") attr.value = cleanCSS(attr.value)
      else if (/^\s*url\(/i.test(attr.value)) attr.value = cleanCSS(attr.value)
    }
  }

  const svg = new XMLSerializer().serializeToString(root)
  return {
    ok: true,
    svg,
    dataURL: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    width: lengthAttr(root, "width"),
    height: lengthAttr(root, "height"),
  }
}

export const InlineSvg = memo(function InlineSvg({
  svg,
  title,
}: {
  svg: Extract<SanitizedSvg, { ok: true }>
  title: string
}) {
  // explicit pixel size: show at that size (never upscaled); otherwise fill the card width
  return (
    <div className="flex justify-center py-1">
      <img
        src={svg.dataURL}
        alt={title}
        draggable={false}
        className="block h-auto max-h-[640px] max-w-full object-contain"
        style={svg.width ? { width: svg.width } : { width: "100%" }}
      />
    </div>
  )
})
