import { cn } from "@/lib/utils"
export const Card = ({ className, ...p }) => <div className={cn("rounded-lg border border-neutral-200 bg-white text-neutral-950 shadow-sm", className)} {...p} />
export const CardHeader = ({ className, ...p }) => <div className={cn("flex flex-col space-y-1.5 p-6", className)} {...p} />
export const CardTitle = ({ className, ...p }) => <h3 className={cn("text-2xl font-semibold leading-none tracking-tight", className)} {...p} />
export const CardDescription = ({ className, ...p }) => <p className={cn("text-sm text-neutral-500", className)} {...p} />
export const CardContent = ({ className, ...p }) => <div className={cn("p-6 pt-0", className)} {...p} />
export const CardFooter = ({ className, ...p }) => <div className={cn("flex items-center p-6 pt-0", className)} {...p} />
export default Card
