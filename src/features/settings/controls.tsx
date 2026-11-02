/**
 * Small, token-driven form controls used by Settings (kept local to the feature so they evolve with it).
 */
import * as SwitchPrimitive from "@radix-ui/react-switch"
import * as SelectPrimitive from "@radix-ui/react-select"
import { Check, ChevronDown, Minus, Plus } from "lucide-react"
import { forwardRef, type ComponentProps, type ReactNode } from "react"
import { cn } from "@/lib/utils"

// ---------- Button ----------

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-ghost"
export const Button = forwardRef<
  HTMLButtonElement,
  ComponentProps<"button"> & { variant?: ButtonVariant; size?: "sm" | "md"; icon?: ReactNode }
>(function Button(
  { variant = "secondary", size = "md", icon, className, children, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-fast disabled:pointer-events-none disabled:opacity-50",
        size === "sm" ? "h-7 px-2.5 text-[12.5px]" : "h-8 px-3 text-[13px]",
        variant === "primary" && "bg-fg text-bg hover:opacity-90",
        variant === "secondary" && "border border-border-strong bg-bg-elevated text-fg hover:bg-bg-muted",
        variant === "ghost" && "text-fg-secondary hover:bg-bg-muted hover:text-fg",
        variant === "danger" && "bg-danger text-fg-on-accent hover:opacity-90",
        variant === "danger-ghost" && "text-danger hover:bg-danger-soft",
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  )
})

// ---------- Inputs ----------

export const TextInput = forwardRef<
  HTMLInputElement,
  ComponentProps<"input"> & { invalid?: boolean; mono?: boolean }
>(function TextInput({ className, invalid, mono, ...props }, ref) {
  return (
    <input
      ref={ref}
      spellCheck={false}
      autoComplete="off"
      className={cn(
        "selectable h-8 w-full min-w-0 rounded-md border border-border-strong bg-bg-elevated px-2.5 text-[13px] text-fg placeholder:text-fg-faint transition-fast",
        "focus:border-accent focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-ring/40",
        "disabled:cursor-not-allowed disabled:bg-bg-muted disabled:text-fg-muted",
        mono && "font-mono text-[12.5px]",
        invalid && "border-danger focus:border-danger focus:ring-danger/30",
        className,
      )}
      {...props}
    />
  )
})

export function Field({
  label,
  hint,
  error,
  children,
  className,
  htmlFor,
}: {
  label: string
  hint?: ReactNode
  error?: string
  children: ReactNode
  className?: string
  htmlFor?: string
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-[12.5px] font-medium text-fg-secondary">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-[12px] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[12px] text-fg-muted">{hint}</p>
      ) : null}
    </div>
  )
}

// ---------- Switch ----------

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "relative inline-flex h-[18px] w-8 shrink-0 cursor-default items-center rounded-full transition-fast",
        "bg-bg-inset data-[state=checked]:bg-accent disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-[14px] translate-x-[2px] rounded-full bg-fg-on-accent shadow-sm transition-transform duration-150 data-[state=checked]:translate-x-[16px]" />
    </SwitchPrimitive.Root>
  )
}

// ---------- Select ----------

export interface SelectOption<T extends string> {
  value: T
  label: string
  description?: string
}

export function Select<T extends string>({
  value,
  onValueChange,
  options,
  className,
  ariaLabel,
  disabled,
}: {
  value: T
  onValueChange(value: T): void
  options: SelectOption<T>[]
  className?: string
  ariaLabel?: string
  disabled?: boolean
}) {
  const current = options.find((option) => option.value === value)
  return (
    <SelectPrimitive.Root
      value={value}
      onValueChange={(next) => onValueChange(next as T)}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        className={cn(
          "inline-flex h-8 min-w-[160px] items-center justify-between gap-2 rounded-md border border-border-strong bg-bg-elevated px-2.5 text-[13px] text-fg transition-fast hover:bg-bg-muted",
          "data-[disabled]:opacity-50",
          className,
        )}
      >
        <SelectPrimitive.Value>{current?.label}</SelectPrimitive.Value>
        <SelectPrimitive.Icon>
          <ChevronDown className="size-3.5 text-fg-muted" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="z-[70] max-h-[320px] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-border bg-bg-elevated p-1 shadow-elevated"
        >
          <SelectPrimitive.Viewport>
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                className="relative flex cursor-default flex-col rounded-md py-1.5 pr-8 pl-2.5 text-[13px] text-fg outline-none data-[highlighted]:bg-bg-muted"
              >
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                {option.description && (
                  <span className="text-[12px] text-fg-muted">{option.description}</span>
                )}
                <SelectPrimitive.ItemIndicator className="absolute top-2 right-2">
                  <Check className="size-3.5 text-fg-secondary" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}

// ---------- Stepper ----------

export function Stepper({
  value,
  min,
  max,
  onChange,
  ariaLabel,
}: {
  value: number
  min: number
  max: number
  onChange(value: number): void
  ariaLabel: string
}) {
  const clamp = (next: number) => Math.min(max, Math.max(min, Math.round(next)))
  return (
    <div className="inline-flex h-8 items-center rounded-md border border-border-strong bg-bg-elevated">
      <button
        type="button"
        aria-label={`Decrease ${ariaLabel}`}
        disabled={value <= min}
        onClick={() => onChange(clamp(value - 1))}
        className="flex h-full w-8 items-center justify-center text-fg-secondary hover:bg-bg-muted disabled:opacity-40"
      >
        <Minus className="size-3.5" />
      </button>
      <input
        aria-label={ariaLabel}
        role="spinbutton"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        inputMode="numeric"
        value={value}
        onChange={(event) => {
          const parsed = Number.parseInt(event.target.value, 10)
          if (Number.isFinite(parsed)) onChange(clamp(parsed))
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp") {
            event.preventDefault()
            onChange(clamp(value + 1))
          } else if (event.key === "ArrowDown") {
            event.preventDefault()
            onChange(clamp(value - 1))
          }
        }}
        className="selectable h-full w-10 border-x border-border bg-transparent text-center text-[13px] tabular-nums text-fg focus:outline-none"
      />
      <button
        type="button"
        aria-label={`Increase ${ariaLabel}`}
        disabled={value >= max}
        onClick={() => onChange(clamp(value + 1))}
        className="flex h-full w-8 items-center justify-center text-fg-secondary hover:bg-bg-muted disabled:opacity-40"
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  )
}

// ---------- Layout ----------

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-fg">{title}</h2>
        {description && <p className="mt-1 text-[13px] leading-relaxed text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mt-7 mb-1 text-[13px] font-semibold text-fg first:mt-0">{children}</h3>
}

/** A settings row: label + description on the left, control on the right, hairline divider below. */
export function SettingRow({
  label,
  description,
  children,
  htmlFor,
}: {
  label: string
  description?: ReactNode
  children: ReactNode
  htmlFor?: string
}) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-border py-3.5 last:border-b-0">
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="block text-[13.5px] text-fg">
          {label}
        </label>
        {description && (
          <div className="mt-0.5 text-[12.5px] leading-relaxed text-fg-muted">{description}</div>
        )}
      </div>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  )
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode
  tone?: "neutral" | "accent" | "success"
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11px] font-medium whitespace-nowrap",
        tone === "neutral" && "bg-bg-inset text-fg-secondary",
        tone === "accent" && "bg-accent-soft text-accent",
        tone === "success" && "bg-success/12 text-success",
      )}
    >
      {children}
    </span>
  )
}
