import { cn } from "@/lib/utils"
export function Input({ className, type, ...p }) {
  return <input type={type} className={cn("flex h-10 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm placeholder:text-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 disabled:cursor-not-allowed disabled:opacity-50", className)} {...p} />
}
export default Input
