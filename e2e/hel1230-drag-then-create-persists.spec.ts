import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { isolateLivePage } from "./support/isolateLivePage";

// HEL-1230 — a drag followed by a panel create before the flush must not be lost: the dragged position
// is still PATCHed by Save now. The drag moves RIGHT (x only) so it cannot land on the cell the
// server places the new panel in (that overlap case is a unit test: the PATCH is then the valid reflow). Real browser, real drag on `.panel-grid-card__handle`, real Add-panel
// flow (Output picker), asserting the captured layout PATCH body. Seeds its own user/dashboard/output
// through the API and deletes the dashboard by exact id.

const CSRF = { "X-Helio-Requested-With": "1" };

async function registerAndLogin(page: Page, request: APIRequestContext) {
  const email = `hel1230-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.test`;
  console.log(`[HEL-1300 e2e] throwaway user: ${email}`);
  const password = "correcthorsebattery1";
  const res = await request.post("/api/auth/register", {
    data: { email, password, displayName: "HEL-1230" },
    headers: CSRF,
  });
  expect(res.status()).toBe(201);
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL("/");
  // HEL-1300: idle the post-login `/` so the API seeding below races none of its mount effects.
  await isolateLivePage(page);
  return email;
}

async function seed(request: APIRequestContext) {
  const dash = await request.post("/api/dashboards", {
    data: { name: "HEL-1230 e2e Dashboard" },
    headers: CSRF,
  });
  expect(dash.status()).toBe(201);
  const dashboardId = ((await dash.json()) as { id: string }).id;
  const panel = await request.post("/api/panels", {
    data: { dashboardId, title: "HEL-1230 A", type: "markdown", config: { content: "A" } },
    headers: CSRF,
  });
  expect(panel.status()).toBe(201);
  const panelId = ((await panel.json()) as { id: string }).id;
  const item = (x: number, w: number) => ({ panelId, x, y: 0, w, h: 4 });
  const layout = { lg: [item(0, 4)], md: [item(0, 5)], sm: [item(0, 3)], xs: [item(0, 2)] };
  const patch = await request.patch(`/api/dashboards/${dashboardId}/update`, {
    data: { fields: ["layout"], dashboard: { layout } },
    headers: CSRF,
  });
  expect(patch.status()).toBe(200);

  const source = await request.post("/api/data-sources", {
    data: {
      name: "HEL-1230 Orders",
      type: "static",
      columns: [
        { name: "created_at", type: "timestamp" },
        { name: "amount", type: "integer" },
      ],
      rows: [["2026-01-01T00:00:00Z", 10]],
    },
    headers: CSRF,
  });
  expect(source.status()).toBe(201);
  const sourceId = ((await source.json()) as { id: string }).id;
  const pipeline = await request.post("/api/pipelines", {
    data: { name: "HEL-1230 Orders Pipeline", roots: [{ sourceId }] },
    headers: CSRF,
  });
  expect(pipeline.status()).toBe(201);
  const pipelineId = ((await pipeline.json()) as { id: string }).id;
  const output = await request.post(`/api/pipelines/${pipelineId}/outputs`, {
    data: { kind: "table", name: "HEL1230 Orders" },
    headers: CSRF,
  });
  expect(output.status()).toBe(201);
  const run = await request.post(`/api/pipelines/${pipelineId}/run`, { data: {}, headers: CSRF });
  expect(run.status()).toBe(200);
  return { dashboardId, panelId, sourceId, pipelineId };
}

test("drag, then add a panel, then Save now PATCHes the dragged position", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1920, height: 1200 });
  await registerAndLogin(page, request);
  const ids = await seed(request);
  try {
    const layoutPatches: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "PATCH" && r.url().includes(`/api/dashboards/${ids.dashboardId}/update`))
        layoutPatches.push(r.postData() ?? "");
    });
    await page.goto(`/dashboards/${ids.dashboardId}`);
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

    // Add a panel BEFORE any flush.
    await page.getByRole("button", { name: "Dashboard actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Add panel" }).click();
    const picker = page.getByRole("dialog", { name: "Add panel" });
    await expect(picker).toBeVisible();
    await page.getByLabel("Search outputs").fill("HEL1230");
    await expect(picker.getByRole("option", { name: /^HEL1230 Orders/ })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(picker).toBeHidden();
    await expect(page.locator(".react-grid-item")).toHaveCount(2, { timeout: 15_000 });

    // The create did not discard the pending drag.
    expect(layoutPatches).toHaveLength(0);
    await page.getByRole("button", { name: "Save now" }).click();
    await expect.poll(() => layoutPatches.length).toBe(1);
    const body = JSON.parse(layoutPatches[0]) as {
      dashboard: { layout: { lg: { panelId: string; x: number }[] } };
    };
    const dragged = body.dashboard.layout.lg.find((i) => i.panelId === ids.panelId);
    expect(dragged).toBeDefined();
    expect(dragged!.x).toBeGreaterThan(0);
  } finally {
    // Exact ids only.
    await request.delete(`/api/dashboards/${ids.dashboardId}`, { headers: CSRF });
    await request.delete(`/api/pipelines/${ids.pipelineId}`, { headers: CSRF });
    await request.delete(`/api/data-sources/${ids.sourceId}`, { headers: CSRF });
  }
});
