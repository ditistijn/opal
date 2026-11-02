import * as SwitchPrimitive from "@radix-ui/react-switch"
import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer inline-flex h-[18px] w-8 shrink-0 items-center rounded-full bg-bg-inset p-[2px] transition-fast data-[state=checked]:bg-accent disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-[14px] rounded-full bg-bg-elevated shadow-sm transition-transform duration-[120ms] data-[state=checked]:translate-x-[14px]" />
    </SwitchPrimitive.Root>
  )
}
