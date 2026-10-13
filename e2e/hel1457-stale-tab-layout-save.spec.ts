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

test("a conflict that cannot be rebased shows the other writer's panel, and a further drag keeps its item", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1920, height: 1200 });
  await registerAndLogin(page, request, AUTH);
  const dash = await request.post("/api/dashboards", {
    data: { name: "HEL-1457 e2e Reject Dashboard" },
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

    const dragA = async (dx: number) => {
      const handle = page
        .locator(".react-grid-item", { hasText: "HEL-1457 A" })
        .locator(".panel-grid-card__handle")
        .first();
      const bb = (await handle.boundingBox())!;
      const sx = bb.x + bb.width / 2;
      const sy = bb.y + bb.height / 2;
      await page.mouse.move(sx, sy);
      await page.mouse.down();
      await page.mouse.move(sx + dx / 2, sy, { steps: 8 });
      await page.mouse.move(sx + dx, sy, { steps: 8 });
      await page.waitForTimeout(50);
      await page.mouse.up();
    };
    await dragA(700);
    await expect(page.getByText("Unsaved changes")).toBeVisible();

    // The other writer places B as a 12x6 block at the top and moves A below it, so the tab's drag of A
    // (same row as before) can no longer be rebased: it would overlap B.
    const second = await request.post("/api/panels", {
      data: { dashboardId, title: "HEL-1457 B", type: "markdown", config: { content: "B" } },
      headers: CSRF,
    });
    expect(second.status()).toBe(201);
    const secondId = ((await second.json()) as { id: string }).id;
    const list = await request.get("/api/dashboards?limit=500");
    const current = (
      (await list.json()) as { items: { id: string; layoutVersion: number }[] }
    ).items.find((d) => d.id === dashboardId)!;
    const patched = await request.patch(`/api/dashboards/${dashboardId}/update`, {
      data: {
        fields: ["layout"],
        dashboard: {
          layout: {
            lg: [
              { panelId: secondId, x: 0, y: 0, w: 12, h: 6 },
              { panelId: firstId, x: 0, y: 6, w: 4, h: 4 },
            ],
          },
          expectedLayoutVersion: current.layoutVersion,
        },
      },
      headers: CSRF,
    });
    expect(patched.status()).toBe(200);

    const rejectedStatuses: number[] = [];
    page.on("response", (r) => {
      if (
        r.request().method() === "PATCH" &&
        r.url().includes(`/api/dashboards/${dashboardId}/update`)
      )
        rejectedStatuses.push(r.status());
    });
    await page.getByRole("button", { name: "Save now" }).click();
    // One refused save and no retry: the rebase was invalid, so the fresh server layout is shown instead.
    await expect.poll(() => rejectedStatuses).toEqual([409]);
    // B renders without a reload, and a further drag of A keeps B's item.
    await expect(page.locator(".react-grid-item")).toHaveCount(2, { timeout: 15_000 });
    // The panel refetch remounts the grid; let it settle before dragging again.
    await expect(page.locator(".react-grid-item", { hasText: "HEL-1457 B" })).toBeVisible();
    await page.waitForTimeout(1000);
    await dragA(300);
    await page.getByRole("button", { name: "Save now" }).click();
    await expect
      .poll(async () => {
        const res = await request.get("/api/dashboards?limit=500");
        const items = ((await res.json()) as { items: { id: string; layout: { lg: Item[] } }[] })
          .items;
        const lg = items.find((d) => d.id === dashboardId)!.layout.lg;
        const b = lg.find((i) => i.panelId === secondId);
        const a = lg.find((i) => i.panelId === firstId);
        return b && a ? [b.x, b.y, a.x > 0] : null;
      })
      .toEqual([0, 0, true]);
  } finally {
    await request.delete(`/api/dashboards/${dashboardId}`, { headers: CSRF });
  }
});
