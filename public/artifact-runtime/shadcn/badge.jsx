import { cn } from "@/lib/utils"
const variants = {
  default: "border-transparent bg-neutral-900 text-white",
  secondary: "border-transparent bg-neutral-100 text-neutral-900",
  destructive: "border-transparent bg-red-600 text-white",
  outline: "text-neutral-900",
}
export function Badge({ className, variant = "default", ...p }) {
  return <div className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold", variants[variant] || variants.default, className)} {...p} />
}
export default Badge
