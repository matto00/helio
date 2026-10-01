import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// HEL-1028 — layout undo/redo must VISIBLY move the rendered panel. Real browser, real drag on
// `.panel-grid-card__handle`, asserting the RENDERED boundingBox (never the store). Before the fix a
// drag only wrote RGL's own live layout, the store layout (and so the `layouts` prop) did not move
// until the 30s autosave, and an immediate undo wrote a deep-equal prop that RGL ignored.
//
// Breakpoints: lg (container >= 1440) and sm (768..1099) are driven by the viewport. The `md` band
// is covered in the unit suite. `xs` is unreachable by RGL: a container under 768px renders
// `MobilePanelStack` with no grid at all, asserted below rather than tested for revert.

const CSRF_HEADER = { "X-Helio-Requested-With": "1" };

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const seededUsers: string[] = [];

async function registerAndLogin(page: Page, request: APIRequestContext, label: string) {
  const email = `hel1028-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.test`;
  const password = "correcthorsebattery1";
  const res = await request.post("/api/auth/register", {
    data: { email, password, displayName: `HEL-1028 ${label}` },
    headers: CSRF_HEADER,
  });
  expect(res.status()).toBe(201);
  seededUsers.push(email);
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL("/");
}

async function seedDashboard(request: APIRequestContext): Promise<string> {
  const dash = await request.post("/api/dashboards", {
    data: { name: "HEL-1028 e2e Dashboard" },
    headers: CSRF_HEADER,
  });
  expect(dash.status()).toBe(201);
  const dashboardId = ((await dash.json()) as { id: string }).id;
  const panelIds: string[] = [];
  for (const title of ["HEL-1028 A", "HEL-1028 B"]) {
    const res = await request.post("/api/panels", {
      data: { dashboardId, title, type: "markdown", config: { content: title } },
      headers: CSRF_HEADER,
    });
    expect(res.status()).toBe(201);
    panelIds.push(((await res.json()) as { id: string }).id);
  }
  // Explicit layout with free space below both panels at every breakpoint.
  const item = (panelId: string, x: number, w: number) => ({ panelId, x, y: 0, w, h: 4 });
  const [a, b] = panelIds;
  const layout = {
    lg: [item(a, 0, 4), item(b, 8, 4)],
    md: [item(a, 0, 5), item(b, 5, 5)],
    sm: [item(a, 0, 3), item(b, 3, 3)],
    xs: [item(a, 0, 2), { panelId: b, x: 0, y: 4, w: 2, h: 4 }],
  };
  const patch = await request.patch(`/api/dashboards/${dashboardId}/update`, {
    data: { fields: ["layout"], dashboard: { layout } },
    headers: CSRF_HEADER,
  });
  expect(patch.status()).toBe(200);
  return dashboardId;
}

async function cleanupDashboard(request: APIRequestContext, id: string) {
  // Exact id only; panels cascade with their dashboard.
  await request.delete(`/api/dashboards/${id}`, { headers: CSRF_HEADER });
}

async function openDashboard(page: Page, dashboardId: string, theme: "light" | "dark") {
  await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
  await page.goto(`/dashboards/${dashboardId}`);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.locator(".react-grid-item")).toHaveCount(2, { timeout: 15_000 });
}

async function boxOf(page: Page, index = 0): Promise<Box> {
  const box = await page.locator(".react-grid-item").nth(index).boundingBox();
  if (!box) throw new Error("panel has no bounding box");
  return box;
}

/** RGL animates items to their snapped position (CSS transform transition); measure only once two
 *  consecutive reads agree, so a mid-animation rect is never captured as "the" position. */
async function settledBox(page: Page, index = 0): Promise<Box> {
  let prev = await boxOf(page, index);
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(100);
    const next = await boxOf(page, index);
    if (
      Math.abs(next.x - prev.x) < 0.5 &&
      Math.abs(next.y - prev.y) < 0.5 &&
      Math.abs(next.width - prev.width) < 0.5 &&
      Math.abs(next.height - prev.height) < 0.5
    )
      return next;
    prev = next;
  }
  throw new Error("panel never settled");
}

async function expectBox(page: Page, expected: Box, index = 0) {
  await expect
    .poll(async () => {
      const b = await boxOf(page, index);
      return [b.x, b.y, b.width, b.height].map(Math.round).join(",");
    })
    .toBe([expected.x, expected.y, expected.width, expected.height].map(Math.round).join(","));
}

async function dragPanel(page: Page, dx: number, dy: number) {
  const handle = page.locator(".panel-grid-card__handle").first();
  const bb = (await handle.boundingBox())!;
  const sx = bb.x + bb.width / 2;
  const sy = bb.y + bb.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + dx / 2, sy + dy / 2, { steps: 8 });
  await page.mouse.move(sx + dx, sy + dy, { steps: 8 });
  await page.waitForTimeout(50);
  await page.mouse.up();
}

async function resizePanel(page: Page, dy: number) {
  const handle = page.locator(".react-resizable-handle").first();
  const bb = (await handle.boundingBox())!;
  const sx = bb.x + bb.width / 2;
  const sy = bb.y + bb.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx, sy + dy, { steps: 10 });
  await page.waitForTimeout(50);
  await page.mouse.up();
}

async function undo(page: Page, via: "keyboard" | "button") {
  if (via === "keyboard") await page.keyboard.press("Control+z");
  else await page.getByRole("button", { name: "Undo layout change" }).click();
}

async function redo(page: Page, via: "keyboard" | "button") {
  if (via === "keyboard") await page.keyboard.press("Control+Shift+z");
  else await page.getByRole("button", { name: "Redo layout change" }).click();
}

const viewports = [
  { name: "lg", width: 1920, height: 1200, containerMin: 1440, containerMax: 4000 },
  { name: "sm", width: 1250, height: 1200, containerMin: 768, containerMax: 1099 },
] as const;

test.describe("HEL-1028 layout undo/redo visually reverts the grid", () => {
  test.setTimeout(90_000);

  for (const vp of viewports) {
    for (const theme of ["light", "dark"] as const) {
      for (const via of ["keyboard", "button"] as const) {
        test(`${vp.name} ${theme}: drag, immediate undo, redo via ${via}`, async ({
          page,
          request,
        }) => {
          await page.setViewportSize({ width: vp.width, height: vp.height });
          await registerAndLogin(page, request, `${vp.name}-${theme}-${via}`);
          const dashboardId = await seedDashboard(request);
          try {
            const layoutPatches: string[] = [];
            page.on("request", (r) => {
              if (
                r.method() === "PATCH" &&
                r.url().includes(`/api/dashboards/${dashboardId}/update`)
              )
                layoutPatches.push(r.postData() ?? "");
            });
            await openDashboard(page, dashboardId, theme);

            const container = (await page.locator(".panel-grid").boundingBox())!;
            expect(container.width).toBeGreaterThanOrEqual(vp.containerMin);
            expect(container.width).toBeLessThan(vp.containerMax);

            const before = await settledBox(page);
            await dragPanel(page, 40, 180);
            const dropped = await settledBox(page);
            expect(Math.abs(dropped.y - before.y)).toBeGreaterThan(50);

            // Immediate undo: no 30s wait. The panel must return to where it was before the drag.
            await undo(page, via);
            await expectBox(page, before);
            await redo(page, via);
            await expectBox(page, dropped);
            // And once more, to prove the cycle is repeatable (history is intact).
            await undo(page, via);
            await expectBox(page, before);
            await redo(page, via);
            await expectBox(page, dropped);

            // Flush: exactly one layout PATCH carrying the dropped layout (never lost, never doubled).
            expect(layoutPatches).toHaveLength(0);
            await page.getByRole("button", { name: "Save now" }).click();
            await expect.poll(() => layoutPatches.length).toBe(1);
            await page.waitForTimeout(500);
            expect(layoutPatches).toHaveLength(1);
            await expectBox(page, dropped);
          } finally {
            await cleanupDashboard(request, dashboardId);
          }
        });
      }
    }

    test(`${vp.name}: drag, undo, flush sends no layout PATCH`, async ({ page, request }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await registerAndLogin(page, request, `${vp.name}-noop`);
      const dashboardId = await seedDashboard(request);
      try {
        const layoutPatches: string[] = [];
        page.on("request", (r) => {
          if (r.method() === "PATCH" && r.url().includes(`/api/dashboards/${dashboardId}/update`))
            layoutPatches.push(r.postData() ?? "");
        });
        await openDashboard(page, dashboardId, "light");
        const before = await settledBox(page);
        await dragPanel(page, 40, 180);
        await undo(page, "keyboard");
        await expectBox(page, before);
        // The undo restored the persisted layout: nothing is pending, so there is nothing to save
        // (no "Save now" affordance, no "Unsaved changes") and nothing is ever PATCHed.
        await expect(page.getByRole("button", { name: "Save now" })).toHaveCount(0);
        await expect(page.getByText("Unsaved changes")).toHaveCount(0);
        await page.waitForTimeout(800);
        expect(layoutPatches).toHaveLength(0);
      } finally {
        await cleanupDashboard(request, dashboardId);
      }
    });

    test(`${vp.name}: resize, immediate undo, redo (keyboard)`, async ({ page, request }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await registerAndLogin(page, request, `${vp.name}-resize`);
      const dashboardId = await seedDashboard(request);
      try {
        await openDashboard(page, dashboardId, "light");
        const before = await settledBox(page);
        await resizePanel(page, 110);
        const resized = await settledBox(page);
        expect(resized.height - before.height).toBeGreaterThan(40);
        await undo(page, "keyboard");
        await expectBox(page, before);
        await redo(page, "keyboard");
        await expectBox(page, resized);
      } finally {
        await cleanupDashboard(request, dashboardId);
      }
    });
  }

  test("xs: a container under 768px renders the mobile stack with no RGL grid to revert", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 430, height: 900 });
    await registerAndLogin(page, request, "xs");
    const dashboardId = await seedDashboard(request);
    try {
      await page.goto(`/dashboards/${dashboardId}`);
      await expect(page.locator(".panel-grid-card__handle")).toHaveCount(0);
      await expect(page.locator(".react-grid-item")).toHaveCount(0);
    } finally {
      await cleanupDashboard(request, dashboardId);
    }
  });

  test.afterAll(() => {
    // Registered users have no delete API; list them so residue is traceable by exact email.
    console.log(`[HEL-1028 e2e] throwaway users registered: ${JSON.stringify(seededUsers)}`);
  });
});
