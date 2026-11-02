import { encode } from "uqr"
import { useMemo } from "react"

/**
 * QR code as one SVG path. Scanners need dark modules on a light field in both themes, so the code is always
 * drawn black-on-white (the one deliberate exception to theme tokens).
 */
export function QrCode({ value, size = 184, label }: { value: string; size?: number; label: string }) {
  const { path, dimension } = useMemo(() => {
    const qr = encode(value, { ecc: "M", border: 2 })
    let d = ""
    qr.data.forEach((row, y) =>
      row.forEach((on, x) => {
        if (on) d += `M${x} ${y}h1v1h-1z`
      }),
    )
    return { path: d, dimension: qr.size }
  }, [value])
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${dimension} ${dimension}`}
      shapeRendering="crispEdges"
      className="rounded-md"
    >
      <rect width={dimension} height={dimension} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  )
}
