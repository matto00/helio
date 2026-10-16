import { expect, test } from "@playwright/test";
import { registerAndLogin } from "./support/auth";

// HEL-1575 fix cycle 3 (reload path): a reload issued right after an own panel edit must show the edit.
// The browser copy of the active dashboard is snapshotted on a debounce; an own write recorded between
// the snapshot and the reload used to be claimed as covering a copy that did not contain it, so the
// reload restored the OLD (empty) list with no request. Each case reloads at a different distance from
// the write; none may restore a stale list.

const CSRF = { "X-Helio-Requested-With": "1" };
const AUTH = { prefix: "hel1575reload", displayName: "HEL-1575", logEmail: false } as const;

for (const [name, delayMs] of [
  ["immediately", 0],
  ["after 300 ms", 300],
  ["after 1.2 s", 1200],
  ["after 1.8 s", 1800],
  ["after 2.4 s", 2400],
] as const) {
  test(`a text panel added through the UI is still there after a reload ${name}`, async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1920, height: 1200 });
    await registerAndLogin(page, request, AUTH);
    await page.goto("about:blank");
    const dash = await request.post("/api/dashboards", {
      data: { name: `HEL-1575 reload ${name}` },
      headers: CSRF,
    });
    expect(dash.status()).toBe(201);
    const dashboardId = ((await dash.json()) as { id: string }).id;
    try {
      await page.goto(`/dashboards/${dashboardId}`);
      // Let the empty list settle and its browser copy be written (debounce 1.5 s + 0.4 s).
      await expect(page.getByText("0 panels")).toBeVisible();
      await page.waitForTimeout(2600);
      await page
        .getByRole("group", { name: "Dashboard actions" })
        .getByRole("button", { name: "Add panel" })
        .click();
      await page.getByRole("option", { name: "Add Text panel" }).click();
      await expect(page.locator(".react-grid-item")).toHaveCount(1, { timeout: 15_000 });
      if (delayMs > 0) await page.waitForTimeout(delayMs);
      await page.reload();
      await expect(page.locator(".react-grid-item")).toHaveCount(1, { timeout: 15_000 });
    } finally {
      await request.delete(`/api/dashboards/${dashboardId}`, { headers: CSRF });
    }
  });
}
