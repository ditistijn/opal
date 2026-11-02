import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"

export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-fast disabled:pointer-events-none disabled:opacity-40 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        accent: "bg-accent text-fg-on-accent hover:bg-accent-hover",
        primary: "bg-fg text-bg hover:opacity-90",
        outline: "border border-border-strong bg-bg-elevated text-fg hover:bg-bg-muted",
        ghost: "text-fg-secondary hover:bg-bg-inset/70 hover:text-fg",
        subtle: "bg-bg-muted text-fg hover:bg-bg-inset",
        danger: "bg-danger text-fg-on-accent hover:opacity-90",
        link: "text-fg-secondary underline-offset-4 hover:text-fg hover:underline",
      },
      size: {
        xs: "h-6 rounded-sm px-2 text-xs [&_svg]:size-3.5",
        sm: "h-7 rounded-md px-2.5 text-[13px] [&_svg]:size-4",
        md: "h-8 rounded-md px-3 text-[13px] [&_svg]:size-4",
        lg: "h-9 rounded-md px-4 text-sm [&_svg]:size-4",
        icon: "size-8 rounded-md [&_svg]:size-4",
        "icon-sm": "size-7 rounded-md [&_svg]:size-4",
        "icon-xs": "size-6 rounded-sm [&_svg]:size-3.5",
      },
    },
    defaultVariants: { variant: "ghost", size: "md" },
  },
)

export interface ButtonProps extends ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export function Button({ className, variant, size, asChild, type = "button", ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button"
  return (
    <Comp
      type={asChild ? undefined : type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}
