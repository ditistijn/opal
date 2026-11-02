import { cn } from "@/lib/utils"
export function Progress({ className, value = 0, ...p }) {
  return (
    <div role="progressbar" aria-valuenow={value} className={cn("relative h-4 w-full overflow-hidden rounded-full bg-neutral-100", className)} {...p}>
      <div className="h-full bg-neutral-900 transition-all" style={{ width: `${Math.max(0, Math.min(100, value || 0))}%` }} />
    </div>
  )
}
export default Progress
