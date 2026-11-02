import { createContext, useContext, useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
// shadcn/Radix-shaped Select built on a popover list (no portal).
const Ctx = createContext(null)
export function Select({ value, defaultValue, onValueChange, children, disabled }) {
  const [inner, setInner] = useState(defaultValue)
  const [open, setOpen] = useState(false)
  const [labels, setLabels] = useState({})
  const current = value !== undefined ? value : inner
  const ref = useRef(null)
  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [])
  const select = (v) => { if (value === undefined) setInner(v); onValueChange && onValueChange(v); setOpen(false) }
  const register = (v, label) => setLabels((l) => (l[v] === label ? l : { ...l, [v]: label }))
  return <Ctx.Provider value={{ value: current, open, setOpen, select, labels, register, disabled }}><div ref={ref} className="relative">{children}</div></Ctx.Provider>
}
export function SelectTrigger({ className, children, ...p }) {
  const ctx = useContext(Ctx)
  return <button type="button" disabled={ctx.disabled} onClick={() => ctx.setOpen(!ctx.open)}
    className={cn("flex h-10 w-full items-center justify-between rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm disabled:opacity-50", className)} {...p}>
    {children}<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-50"><path d="m6 9 6 6 6-6" /></svg>
  </button>
}
export function SelectValue({ placeholder }) {
  const ctx = useContext(Ctx)
  const label = ctx.value !== undefined ? ctx.labels[ctx.value] ?? ctx.value : undefined
  return <span className={label === undefined ? "text-neutral-400" : ""}>{label ?? placeholder}</span>
}
export function SelectContent({ className, children }) {
  const ctx = useContext(Ctx)
  return <div className={cn("absolute z-50 mt-1 max-h-72 w-full min-w-[8rem] overflow-auto rounded-md border border-neutral-200 bg-white p-1 shadow-md", ctx.open ? "" : "hidden", className)}>{children}</div>
}
export function SelectItem({ value, className, children }) {
  const ctx = useContext(Ctx)
  const label = typeof children === "string" ? children : value
  useEffect(() => { ctx.register(value, label) }, [value, label])
  const active = ctx.value === value
  return <div role="option" aria-selected={active} onClick={() => ctx.select(value)}
    className={cn("relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm hover:bg-neutral-100", className)}>
    {active ? <span className="absolute left-2">✓</span> : null}{children}
  </div>
}
export const SelectGroup = ({ children }) => <div>{children}</div>
export const SelectLabel = ({ className, ...p }) => <div className={cn("py-1.5 pl-8 pr-2 text-sm font-semibold", className)} {...p} />
export const SelectSeparator = () => <div className="-mx-1 my-1 h-px bg-neutral-100" />
export default Select
