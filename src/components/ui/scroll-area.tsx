import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"
import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"

/** macOS-like overlay scrollbars. Pass `viewportRef` to control scrolling. */
export function ScrollArea({
  className,
  children,
  viewportRef,
  viewportClassName,
  ...props
}: ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  viewportRef?: React.Ref<HTMLDivElement>
  viewportClassName?: string
}) {
  return (
    <ScrollAreaPrimitive.Root className={cn("relative overflow-hidden", className)} {...props}>
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        className={cn("size-full rounded-[inherit]", viewportClassName)}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar
        orientation="vertical"
        className="flex w-2.5 touch-none select-none p-[2px] opacity-0 transition-opacity duration-150 data-[state=visible]:opacity-100"
      >
        <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-border-strong" />
      </ScrollAreaPrimitive.Scrollbar>
    </ScrollAreaPrimitive.Root>
  )
}
