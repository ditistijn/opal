import * as TabsPrimitive from "@radix-ui/react-tabs"
import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"

export const Tabs = TabsPrimitive.Root
export const TabsContent = TabsPrimitive.Content

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn("inline-flex items-center rounded-md bg-bg-inset/60 p-0.5", className)}
      {...props}
    />
  )
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "rounded-[5px] px-3 py-0.5 text-[12.5px] font-medium text-fg-muted transition-fast hover:text-fg data-[state=active]:bg-bg-elevated data-[state=active]:text-fg data-[state=active]:shadow-sm",
        className,
      )}
      {...props}
    />
  )
}
