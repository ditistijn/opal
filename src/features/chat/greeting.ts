/** Time-of-day greeting shown on the new-chat screen. */
export function greetingFor(date = new Date()) {
  const h = date.getHours()
  if (h >= 5 && h < 12) return "Good morning"
  if (h >= 12 && h < 18) return "Good afternoon"
  return "Good evening"
}
