import { expect, test } from "@playwright/test";
import { registerAndLogin } from "./support/auth";

// HEL-1575 fix cycle 3: reloading a warm tab while the browser-store read is slow (past the 500 ms restore
// timeout) keeps the loading skeleton up for the whole window. That skeleton's grid used to be drawn first for
// the default-selected dashboard at the initial width, then for the URL's dashboard at the measured width, in
// ONE render; react-grid-layout 2.2.4 never settles on that change ("Maximum update depth exceeded", 50+ errors
// before the first panels request). The skeleton grid is now keyed by dashboard, like the real grid.

const CSRF = { "X-Helio-Requested-With": "1" };
const RESTORE_DELAY_MS = 800;

test("a reload with a slow browser-store read shows the panels with no update-depth errors", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const delay = Number(window.localStorage.getItem("hel1575IdbReadDelay") ?? "0");
    if (!delay) return;
    const originalGet = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (key: IDBValidKey | IDBKeyRange) {
      const req = originalGet.call(this, key);
      Object.defineProperty(req, "onsuccess", {
        configurable: true,
        set(handler: (event: Event) => void) {
          req.addEventListener("success", (event) => {
            setTimeout(() => handler.call(req, event), delay);
          });
        },
      });
      return req;
    };
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await registerAndLogin(page, request, {
    prefix: "hel1575slow",
    displayName: "HEL-1575",
    logEmail: false,
  });
  await page.goto("about:blank");
  const ids: string[] = [];
  try {
    for (const name of ["A", "B", "C"]) {
      const dash = await request.post("/api/dashboards", { data: { name }, headers: CSRF });
      expect(dash.status()).toBe(201);
      const dashboardId = ((await dash.json()) as { id: string }).id;
      ids.push(dashboardId);
      const panel = await request.post("/api/panels", {
        data: { dashboardId, title: name, type: "markdown", config: { content: name } },
        headers: CSRF,
      });
      expect(panel.status()).toBe(201);
      const panelId = ((await panel.json()) as { id: string }).id;
      const layout = await request.post(`/api/dashboards/${dashboardId}/auto-layout`, {
        data: { items: [{ panelId, w: 6, h: 5 }] },
        headers: CSRF,
      });
      expect(layout.ok()).toBe(true);
    }
    await page.goto(`/dashboards/${ids[0]}`);
    await expect(page.locator(".react-grid-item")).toHaveCount(1);
    // Let the browser copy of this dashboard be written (debounce 1.5 s + write) so the reload restores it.
    await page.waitForTimeout(3000);
    await page.evaluate(
      (delay) => window.localStorage.setItem("hel1575IdbReadDelay", String(delay)),
      RESTORE_DELAY_MS,
    );
    errors.length = 0;
    await page.reload();
    await expect(page.locator(".react-grid-item")).toHaveCount(1, { timeout: 15_000 });
    await page.waitForTimeout(1500);
    expect(errors.filter((text) => text.includes("Maximum update depth"))).toEqual([]);
  } finally {
    for (const id of ids) await request.delete(`/api/dashboards/${id}`, { headers: CSRF });
  }
});
