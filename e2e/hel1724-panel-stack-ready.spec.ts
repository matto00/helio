import { expect, test, type APIRequestContext } from "@playwright/test";

import { CSRF_HEADER, registerAndLogin } from "./support/auth";
import { waitForPanelStack } from "./support/panelGridReady";

// HEL-1724 - guard for `waitForPanelStack`, the phone-width twin of HEL-1633's `waitForPanelGrid`. After a dashboard
// load the loading skeleton's `.mobile-panel-stack__item` stubs fade out over the real cards (HEL-1584 Crossfade;
// both layers share one grid cell), so a geometry read taken then sees stubs overlapping the real cards (gap -380px,
// main CI run 43925410610). This spec delays the panels fetch so the skeleton is on screen, stretches ONLY the
// panels-level skeleton layer's fade to 3 s, calls the helper straight after `goto`, and then takes one-shot
// (non-retrying) reads: a retrying matcher would hide a broken helper because the stubs unmount on their own later.
//
// Failability (recorded in the HEL-1724 evidence): the helper without its "skeleton unmounted" step returns while
// the stretched fade is still running; without its "live items" step it returns before React mounts anything.
const AUTH = { prefix: "hel1724", displayName: "HEL-1724" } as const;
const json = { [CSRF_HEADER]: "1" };
const PANEL_COUNT = 3;
const PANELS_DELAY_MS = 1500;
const FADE_MS = 3000;

async function seedDashboard(request: APIRequestContext): Promise<string> {
  const dash = await request.post("/api/dashboards", {
    data: { name: "HEL-1724 Stack ready" },
    headers: json,
  });
  expect(dash.status()).toBe(201);
  const dashboardId = ((await dash.json()) as { id: string }).id;
  for (const title of ["A", "B", "C"]) {
    const panel = await request.post("/api/panels", {
      data: {
        dashboardId,
        title: `HEL-1724 ${title}`,
        type: "markdown",
        config: { content: title },
      },
      headers: json,
    });
    expect(panel.status()).toBe(201);
  }
  return dashboardId;
}

test("waitForPanelStack returns only once the real phone stack is up and the skeleton has unmounted", async ({
  page,
  request,
}) => {
  await registerAndLogin(page, request, { ...AUTH, isolate: true });
  const dashboardId = await seedDashboard(page.request);
  await page.setViewportSize({ width: 375, height: 800 });

  // Stretch only the skeleton layers' fade. The selector outranks Crossfade.css; `!important` makes it certain.
  await page.addInitScript((ms) => {
    const style = document.createElement("style");
    style.textContent = `:root .crossfade .crossfade__skeleton { transition-duration: ${ms}ms !important; }`;
    document.addEventListener("DOMContentLoaded", () => document.head.appendChild(style));
  }, FADE_MS);
  // Keep the skeleton on screen: hold the panels response back.
  await page.route("**/api/dashboards/*/panels", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, PANELS_DELAY_MS));
    await route.continue();
  });

  await page.goto(`/dashboards/${dashboardId}`, { waitUntil: "commit" });
  // The helper starts immediately, while nothing has mounted yet; the checks below prove the scenario (stubs on
  // screen, fade stretched) while it is waiting. They target the panels-level skeleton layer, the one that holds
  // [aria-label="Loading panels"], not an inner per-panel body-skeleton crossfade.
  const panelsSkeleton = page.locator(".crossfade__skeleton", {
    has: page.getByLabel("Loading panels"),
  });
  const ready = waitForPanelStack(page, PANEL_COUNT, { timeout: 15_000 });
  await Promise.all([
    ready,
    (async () => {
      await expect(panelsSkeleton.locator(".mobile-panel-stack__item").first()).toBeAttached();
      await expect(panelsSkeleton).toHaveCSS("transition-duration", "3s");
    })(),
  ]);

  // One-shot reads only: no retry may paper over a helper that returned too early.
  const items = await page.locator(".mobile-panel-stack__item").count();
  const skeletons = await page.getByLabel("Loading panels").count();
  const boxes = await page.locator(".mobile-panel-stack__item").evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { w: r.width, h: r.height, top: r.top, bottom: r.bottom };
    }),
  );
  expect(items, "no skeleton stub is left among the stack items").toBe(PANEL_COUNT);
  expect(skeletons, "the loading skeleton has unmounted").toBe(0);
  expect(boxes.length).toBe(PANEL_COUNT);
  for (const box of boxes) {
    expect(box.w).toBeGreaterThan(0);
    expect(box.h).toBeGreaterThan(0);
  }
  for (let i = 1; i < boxes.length; i += 1) {
    expect(boxes[i].top - boxes[i - 1].bottom, `gap ${i}`).toBeGreaterThanOrEqual(0);
  }
});
