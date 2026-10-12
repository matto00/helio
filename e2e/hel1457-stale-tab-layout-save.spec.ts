import { expect, test, type APIRequestContext } from "@playwright/test";
import { registerAndLogin } from "./support/auth";

// HEL-1457 — a layout save from a tab that is behind the server must not drop another writer's panel.
// Real browser, real drag on `.panel-grid-card__handle`: the tab drags its only panel, a second panel is then
// created through the API as the same throwaway user (an agent placing a panel while the tab is open), and
// Save now must conflict (409), rebase onto the server layout and retry, leaving BOTH panels placed and the drag
// kept, with no error shown. Seeds its own user and dashboard and deletes the dashboard by exact id.

const CSRF = { "X-Helio-Requested-With": "1" };
const AUTH = { prefix: "hel1457", displayName: "HEL-1457", isolate: true } as const;

type Item = { panelId: string; x: number; y: number };

async function storedLg(request: APIRequestContext, dashboardId: string): Promise<Item[]> {
  const res = await request.get("/api/dashboards?limit=500");
  expect(res.status()).toBe(200);
  const items = ((await res.json()) as { items: { id: string; layout: { lg: Item[] } }[] }).items;
  return items.find((d) => d.id === dashboardId)!.layout.lg;
}

test("a drag saved from a stale tab keeps a panel created meanwhile", async ({ page, request }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1920, height: 1200 });
  await registerAndLogin(page, request, AUTH);
  const dash = await request.post("/api/dashboards", {
    data: { name: "HEL-1457 e2e Dashboard" },
    headers: CSRF,
  });
  expect(dash.status()).toBe(201);
  const dashboardId = ((await dash.json()) as { id: string }).id;
  try {
    const first = await request.post("/api/panels", {
      data: { dashboardId, title: "HEL-1457 A", type: "markdown", config: { content: "A" } },
      headers: CSRF,
    });
    expect(first.status()).toBe(201);
    const firstId = ((await first.json()) as { id: string }).id;

    await page.goto(`/dashboards/${dashboardId}`);
    await expect(page.locator(".react-grid-item")).toHaveCount(1, { timeout: 15_000 });

    const handle = page.locator(".panel-grid-card__handle").first();
    const bb = (await handle.boundingBox())!;
    const sx = bb.x + bb.width / 2;
    const sy = bb.y + bb.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 300, sy, { steps: 8 });
    await page.mouse.move(sx + 700, sy, { steps: 8 });
    await page.waitForTimeout(50);
    await page.mouse.up();
    await expect(page.getByText("Unsaved changes")).toBeVisible();

    // Another writer places a panel while this tab holds an unsaved drag.
    const second = await request.post("/api/panels", {
      data: { dashboardId, title: "HEL-1457 B", type: "markdown", config: { content: "B" } },
      headers: CSRF,
    });
    expect(second.status()).toBe(201);
    const secondId = ((await second.json()) as { id: string }).id;

    const statuses: number[] = [];
    page.on("response", (r) => {
      if (
        r.request().method() === "PATCH" &&
        r.url().includes(`/api/dashboards/${dashboardId}/update`)
      )
        statuses.push(r.status());
    });
    await page.getByRole("button", { name: "Save now" }).click();
    await expect.poll(() => statuses).toEqual([409, 200]);

    const stored = await storedLg(request, dashboardId);
    expect(stored.map((i) => i.panelId).sort()).toEqual([firstId, secondId].sort());
    expect(stored.find((i) => i.panelId === firstId)!.x).toBeGreaterThan(0);

    // The other writer's panel renders without a reload (D7e).
    await expect(page.locator(".react-grid-item")).toHaveCount(2, { timeout: 15_000 });
    await expect(page.getByText("Unsaved changes")).toBeHidden();

    await page.reload();
    await expect(page.locator(".react-grid-item")).toHaveCount(2, { timeout: 15_000 });
    const reloaded = await storedLg(request, dashboardId);
    expect(reloaded.map((i) => i.panelId).sort()).toEqual([firstId, secondId].sort());
  } finally {
    await request.delete(`/api/dashboards/${dashboardId}`, { headers: CSRF });
  }
});
