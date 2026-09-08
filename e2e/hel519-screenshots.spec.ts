import { expect, test } from "@playwright/test";

// HEL-519 task 6.4 — visual cohesion evidence. A token check does not substitute (owner-mandated):
// screenshots go to `.concertino/runs/HEL-519/evidence/` ONLY.
const CSRF_HEADER = "X-Helio-Requested-With";

async function registerAndLogin(page: any, request: any, label: string) {
  const email = `hel519-shot-${label}-${Date.now()}@example.test`;
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
  await expect(page.getByRole("button", { name: "Add dashboard" })).toBeVisible();
}

async function openPalette(page: any) {
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
}

for (const theme of ["light", "dark"] as const) {
  test(`palette Recent section beside existing sections — ${theme}`, async ({ page, request }) => {
    await registerAndLogin(page, request, theme);

    const sourceRes = await request.post("/api/data-sources", {
      data: {
        name: "HEL-519 Screenshot Source",
        type: "static",
        columns: [{ name: "amount", type: "integer" }],
        rows: [[1]],
      },
      headers: { [CSRF_HEADER]: "1" },
    });
    const source = await sourceRes.json();

    await page.goto("/sources");
    await page.locator(".source-list-table__name", { hasText: source.name }).click();
    await page.waitForURL(new RegExp(`/sources/${source.id}$`));

    if (theme === "light") {
      await openPalette(page);
      await page.fill('input[aria-label="Search commands"]', "light theme");
      await page.getByRole("option", { name: "Switch to light theme" }).click();
    }

    await openPalette(page);
    await page.fill('input[aria-label="Search commands"]', "");
    await expect(
      page.locator(".command-palette__group-label", { hasText: "Recent" }),
    ).toBeVisible();
    await page.screenshot({
      path: `.concertino/runs/HEL-519/evidence/palette-recent-rest-${theme}.png`,
    });

    const items = page.locator(".command-palette__item");
    await items.nth(0).hover();
    await page.screenshot({
      path: `.concertino/runs/HEL-519/evidence/palette-recent-hover-${theme}.png`,
    });

    await page.keyboard.press("ArrowDown");
    await page.screenshot({
      path: `.concertino/runs/HEL-519/evidence/palette-recent-focused-${theme}.png`,
    });
  });
}
