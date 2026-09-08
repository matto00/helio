import { expect, test } from "@playwright/test";

const CSRF_HEADER = "X-Helio-Requested-With";

async function registerAndLogin(page: any, request: any, label: string) {
  const email = `hel516-shot-${label}-${Date.now()}@example.test`;
  const password = "correcthorsebattery1";
  await request.post("/api/auth/register", {
    data: { email, password, displayName: `Shot ${label}` },
    headers: { [CSRF_HEADER]: "1" },
  });
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL("/");
}

async function openPaletteWithCreate(page: any) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect
    .poll(
      async () => {
        await page.keyboard.press("Control+k");
        return page.locator(".command-palette[open]").count();
      },
      { timeout: 15000 },
    )
    .toBeGreaterThan(0);
  await page.fill('input[aria-label="Search commands"]', "");
}

for (const theme of ["light", "dark"] as const) {
  test(`palette Create section + KeyCap — ${theme}`, async ({ page, request }) => {
    await registerAndLogin(page, request, theme);
    await page.goto("/");
    // The app's own default theme is dark (a fresh account's palette offers "Switch to light
    // theme"), so only the "light" run needs to toggle. `ThemeProvider`'s own effect re-applies
    // `data-theme` from React state on every render, so setting the DOM attribute directly would
    // get overwritten — go through the app's own palette toggle action instead, the same command
    // a real user would run.
    if (theme === "light") {
      await openPaletteWithCreate(page);
      await page.fill('input[aria-label="Search commands"]', "light theme");
      await page.getByRole("option", { name: "Switch to light theme" }).click();
    }
    await openPaletteWithCreate(page);
    await page.screenshot({
      path: `.concertino/runs/HEL-516/evidence/palette-rest-${theme}.png`,
    });

    const items = page.locator(".command-palette__item");
    const count = await items.count();
    if (count > 0) {
      await items.nth(0).hover();
      await page.screenshot({
        path: `.concertino/runs/HEL-516/evidence/palette-hover-${theme}.png`,
      });
    }

    await page.keyboard.press("ArrowDown");
    await page.screenshot({
      path: `.concertino/runs/HEL-516/evidence/palette-focused-${theme}.png`,
    });

    await page.keyboard.press("Escape");
    await page.locator("body").click({ position: { x: 400, y: 300 } });
    await page.keyboard.press("?");
    await page.waitForSelector(".help-overlay[open]");
    await page.screenshot({
      path: `.concertino/runs/HEL-516/evidence/help-overlay-${theme}.png`,
    });
  });
}
