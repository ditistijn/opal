import "./ui.css"
import * as Menu from "@radix-ui/react-dropdown-menu"
import { Check, ChevronRight } from "lucide-react"
import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"

export const DropdownMenu = Menu.Root
export const DropdownMenuTrigger = Menu.Trigger
export const DropdownMenuGroup = Menu.Group
export const DropdownMenuSub = Menu.Sub
export const DropdownMenuRadioGroup = Menu.RadioGroup

const itemBase =
  "relative flex h-8 cursor-default select-none items-center gap-2 rounded-md px-2 text-[13px] text-fg outline-none transition-colors duration-[80ms] data-[highlighted]:bg-bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-fg-secondary"

export function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: ComponentProps<typeof Menu.Content>) {
  return (
    <Menu.Portal>
      <Menu.Content
        sideOffset={sideOffset}
        className={cn(
          "opal-pop z-50 min-w-[180px] rounded-lg border border-border bg-bg-elevated p-1 shadow-elevated",
          className,
        )}
        {...props}
      />
    </Menu.Portal>
  )
}

export function DropdownMenuItem({
  className,
  destructive,
  ...props
}: ComponentProps<typeof Menu.Item> & { destructive?: boolean }) {
  return (
    <Menu.Item
      className={cn(
        itemBase,
        destructive && "text-danger [&_svg]:text-danger data-[highlighted]:bg-danger-soft",
        className,
      )}
      {...props}
    />
  )
}

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: ComponentProps<typeof Menu.RadioItem>) {
  return (
    <Menu.RadioItem className={cn(itemBase, "pr-8", className)} {...props}>
      {children}
      <Menu.ItemIndicator className="absolute right-2 flex items-center">
        <Check />
      </Menu.ItemIndicator>
    </Menu.RadioItem>
  )
}

export function DropdownMenuSubTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof Menu.SubTrigger>) {
  return (
    <Menu.SubTrigger className={cn(itemBase, "data-[state=open]:bg-bg-muted", className)} {...props}>
      {children}
      <ChevronRight className="ml-auto" />
    </Menu.SubTrigger>
  )
}

export function DropdownMenuSubContent({ className, ...props }: ComponentProps<typeof Menu.SubContent>) {
  return (
    <Menu.Portal>
      <Menu.SubContent
        className={cn(
          "opal-pop z-50 min-w-[200px] rounded-lg border border-border bg-bg-elevated p-1 shadow-elevated",
          className,
        )}
        {...props}
      />
    </Menu.Portal>
  )
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof Menu.Label>) {
  return (
    <Menu.Label
      className={cn("px-2 pb-1 pt-1.5 text-[11.5px] font-medium text-fg-muted", className)}
      {...props}
    />
  )
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof Menu.Separator>) {
  return <Menu.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />
}
