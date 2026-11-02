import { useEffect } from "react"
import { runtime } from "@/lib/runtime"

/** Applies the user's theme preference to <html data-theme>, following the OS when "system". */
export function useTheme() {
  const settings = runtime.useSettings()
  const preference = settings.theme
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)")
    const apply = () => {
      const dark = preference === "dark" || (preference === "system" && media.matches)
      document.documentElement.dataset.theme = dark ? "dark" : "light"
      try {
        localStorage.setItem("opal.theme", preference)
      } catch {}
    }
    apply()
    media.addEventListener("change", apply)
    return () => media.removeEventListener("change", apply)
  }, [preference])
}
