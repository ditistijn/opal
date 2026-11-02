import { cn } from "@/lib/utils"
export function Textarea({ className, ...p }) {
  return <textarea className={cn("flex min-h-[80px] w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm placeholder:text-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 disabled:cursor-not-allowed disabled:opacity-50", className)} {...p} />
}
export default Textarea
