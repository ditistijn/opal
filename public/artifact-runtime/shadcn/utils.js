// Minimal `@/lib/utils` for artifacts written against shadcn/ui: cn() joins class names.
export function cn(...inputs) {
  const out = []
  const add = (v) => {
    if (!v) return
    if (typeof v === "string" || typeof v === "number") out.push(String(v))
    else if (Array.isArray(v)) v.forEach(add)
    else if (typeof v === "object") for (const k in v) if (v[k]) out.push(k)
  }
  inputs.forEach(add)
  return out.join(" ")
}
