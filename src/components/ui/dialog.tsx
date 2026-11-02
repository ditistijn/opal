import "./ui.css"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import type { ComponentProps, ReactNode } from "react"
import { cn } from "@/lib/utils"

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

export function DialogContent({
  className,
  children,
  hideClose,
  overlayClassName,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { hideClose?: boolean; overlayClassName?: string }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn("opal-fade fixed inset-0 z-50 bg-black/25 dark:bg-black/50", overlayClassName)}
      />
      <DialogPrimitive.Content
        className={cn(
          "opal-pop fixed left-1/2 top-1/2 z-50 w-[min(92vw,460px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-bg-elevated p-5 text-fg shadow-elevated outline-none",
          className,
        )}
        {...props}
      >
        {children}
        {hideClose ? null : (
          <DialogPrimitive.Close
            aria-label="Close"
            className="absolute right-3 top-3 flex size-7 items-center justify-center rounded-md text-fg-muted transition-fast hover:bg-bg-muted hover:text-fg"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("text-[15px] font-semibold text-fg", className)} {...props} />
}

export function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description className={cn("mt-1 text-[13px] text-fg-secondary", className)} {...props} />
  )
}

export function DialogFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mt-5 flex items-center justify-end gap-2", className)}>{children}</div>
}
