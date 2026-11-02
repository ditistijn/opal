import { cn } from "@/lib/utils"
export function Separator({ className, orientation = "horizontal", decorative, ...p }) {
  return <div role={decorative ? "none" : "separator"} className={cn("shrink-0 bg-neutral-200", orientation === "horizontal" ? "h-px w-full" : "h-full w-px", className)} {...p} />
}
export default Separator
