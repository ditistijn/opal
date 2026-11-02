import { cn } from "@/lib/utils"
const variants = { default: "bg-white text-neutral-950 border-neutral-200", destructive: "border-red-300 text-red-700 bg-red-50" }
export const Alert = ({ className, variant = "default", ...p }) => <div role="alert" className={cn("relative w-full rounded-lg border p-4 [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg+div]:translate-y-[-3px] [&>svg~*]:pl-7", variants[variant] || variants.default, className)} {...p} />
export const AlertTitle = ({ className, ...p }) => <h5 className={cn("mb-1 font-medium leading-none tracking-tight", className)} {...p} />
export const AlertDescription = ({ className, ...p }) => <div className={cn("text-sm [&_p]:leading-relaxed", className)} {...p} />
export default Alert
