import { cn } from "@/lib/utils"
export function Label({ className, ...p }) {
  return <label className={cn("text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70", className)} {...p} />
}
export default Label
