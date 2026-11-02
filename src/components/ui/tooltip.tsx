import "./ui.css"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"
import { cn } from "@/lib/utils"
import type { ComponentProps, ReactNode } from "react"

export const TooltipProvider = TooltipPrimitive.Provider
export const Tooltip = TooltipPrimitive.Root
export const TooltipTrigger = TooltipPrimitive.Trigger

export function TooltipContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          "opal-fade z-50 rounded-md bg-fg px-2 py-1 text-xs text-bg shadow-elevated animate-in fade-in-0 zoom-in-95",
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  )
}

/** Convenience wrapper: `<Tip label="Copy" shortcut="⌘C"><button/></Tip>`. */
export function Tip({
  label,
  shortcut,
  side,
  children,
}: {
  label: ReactNode
  shortcut?: string
  side?: "top" | "bottom" | "left" | "right"
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>
        <span>{label}</span>
        {shortcut ? <span className="ml-2 opacity-60">{shortcut}</span> : null}
      </TooltipContent>
    </Tooltip>
  )
}
