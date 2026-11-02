import "./ui.css"
import * as PopoverPrimitive from "@radix-ui/react-popover"
import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"

export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger
export const PopoverAnchor = PopoverPrimitive.Anchor
export const PopoverClose = PopoverPrimitive.Close

export function PopoverContent({
  className,
  align = "center",
  sideOffset = 6,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "opal-pop z-50 rounded-lg border border-border bg-bg-elevated p-1 text-fg shadow-elevated outline-none",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}
