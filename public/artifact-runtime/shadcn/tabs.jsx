import { createContext, useContext, useState } from "react"
import { cn } from "@/lib/utils"
const Ctx = createContext({ value: undefined, setValue: () => {} })
export function Tabs({ value, defaultValue, onValueChange, className, children, ...p }) {
  const [inner, setInner] = useState(defaultValue)
  const current = value !== undefined ? value : inner
  const setValue = (v) => { if (value === undefined) setInner(v); onValueChange && onValueChange(v) }
  return <Ctx.Provider value={{ value: current, setValue }}><div className={className} {...p}>{children}</div></Ctx.Provider>
}
export const TabsList = ({ className, ...p }) => <div role="tablist" className={cn("inline-flex h-10 items-center justify-center rounded-md bg-neutral-100 p-1 text-neutral-500", className)} {...p} />
export function TabsTrigger({ value, className, ...p }) {
  const ctx = useContext(Ctx)
  const active = ctx.value === value
  return <button type="button" role="tab" aria-selected={active} data-state={active ? "active" : "inactive"} onClick={() => ctx.setValue(value)}
    className={cn("inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium transition-all", active ? "bg-white text-neutral-950 shadow-sm" : "", className)} {...p} />
}
export function TabsContent({ value, className, ...p }) {
  const ctx = useContext(Ctx)
  if (ctx.value !== value) return null
  return <div role="tabpanel" className={cn("mt-2", className)} {...p} />
}
export default Tabs
