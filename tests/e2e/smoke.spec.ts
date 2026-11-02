import { expect, test, type Page } from "@playwright/test"

/**
 * Shell smoke test on the mock runtime: the title bar, the Chat/Code surface switcher and the sidebar
 * render, switching surfaces works, and both themes paint. Screenshots → test-results/screenshots/.
 */

async function openApp(page: Page) {
  await page.goto("/")
  // Title bar: the window drag region that hosts the surface switcher.
  await expect(page.locator("[data-tauri-drag-region]").first()).toBeVisible()
}

test("title bar, surface switcher and sidebar render", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (err) => errors.push(err.message))

  await openApp(page)

  const titleBar = page.locator("[data-tauri-drag-region]").first()
  const box = await titleBar.boundingBox()
  // Must match --titlebar-height (38px) so the macOS traffic lights sit centred in it.
  expect(box?.height).toBe(38)
  expect(box?.y).toBe(0)

  // Labels are lower-case in the DOM and capitalised with CSS.
  const chat = titleBar.getByRole("button", { name: /^chat$/i })
  const code = titleBar.getByRole("button", { name: /^code$/i })
  await expect(chat).toBeVisible()
  await expect(code).toBeVisible()

  await expect(page.getByRole("complementary", { name: "Sidebar" })).toBeVisible()

  await code.click()
  await expect(page.locator("html")).toHaveAttribute("data-surface", "code")
  await chat.click()
  await expect(page.locator("html")).toHaveAttribute("data-surface", "chat")

  expect(errors, `uncaught page errors:\n${errors.join("\n")}`).toEqual([])
})

for (const scheme of ["light", "dark"] as const) {
  test(`renders in ${scheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme })
    // "system" theme follows prefers-color-scheme (see index.html pre-paint script).
    await page.addInitScript(() => {
      try {
        localStorage.setItem("opal.theme", "system")
      } catch {
        // storage unavailable — the default is "system" anyway
      }
    })
    await openApp(page)
    await expect(page.locator("html")).toHaveAttribute("data-theme", scheme)
    await expect(page.getByRole("complementary", { name: "Sidebar" })).toBeVisible()

    // The body background must come from the theme tokens, not the browser default.
    const bg = await page.evaluate(
      () => getComputedStyle(document.querySelector("#root > *")!).backgroundColor,
    )
    expect(bg).not.toBe("rgba(0, 0, 0, 0)")

    await page.waitForTimeout(250) // let fonts/transitions settle (≤150ms motion budget)
    await page.screenshot({ path: `test-results/screenshots/smoke-${scheme}.png` })
  })
}
