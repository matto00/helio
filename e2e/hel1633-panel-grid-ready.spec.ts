import { expect, test, type APIRequestContext } from "@playwright/test";

import { CSRF_HEADER, registerAndLogin } from "./support/auth";
import { waitForPanelGrid } from "./support/panelGridReady";

// HEL-1633 - guard for `waitForPanelGrid`. After a dashboard load the loading skeleton's own `.react-grid-item`s
// fade out under the real grid (HEL-1584 Crossfade); a count or measurement taken then can see the stubs. This spec
// delays the panels fetch so the skeleton is on screen, stretches ONLY the skeleton's fade to 3 s (so a helper that
// skips the "skeleton unmounted" wait is caught deterministically, not by poll timing), calls the helper straight
// after `goto`, and then takes one-shot (non-retrying) reads: a retrying matcher would hide a broken helper because
// the stubs unmount on their own a moment later.
//
// Failability (recorded in the HEL-1633 evidence, each red on 5/5 repetitions): the helper with only its
// "skeleton unmounted" step returns before React mounts anything; with only its "live items" step it returns while
// the stretched fade is still running.
const AUTH = { prefix: "hel1633", displayName: "HEL-1633" } as const;
const json = { [CSRF_HEADER]: "1" };
const PANEL_COUNT = 3;
const PANELS_DELAY_MS = 1500;
const FADE_MS = 3000;

async function seedDashboard(request: APIRequestContext): Promise<string> {
  const dash = await request.post("/api/dashboards", {
    data: { name: "HEL-1633 Grid ready" },
    headers: json,
  });
  expect(dash.status()).toBe(201);
  const dashboardId = ((await dash.json()) as { id: string }).id;
  const ids: string[] = [];
  for (const title of ["A", "B", "C"]) {
    const panel = await request.post("/api/panels", {
      data: {
        dashboardId,
        title: `HEL-1633 ${title}`,
        type: "markdown",
        config: { content: title },
      },
      headers: json,
    });
    expect(panel.status()).toBe(201);
    ids.push(((await panel.json()) as { id: string }).id);
  }
  // A real saved layout: the skeleton renders one stub per saved layout entry.
  const item = (panelId: string, x: number, y: number, w: number) => ({ panelId, x, y, w, h: 5 });
  const row = (w: number) => [item(ids[0], 0, 0, w), item(ids[1], w, 0, w), item(ids[2], 0, 5, w)];
  const layout = {
    lg: row(6),
    md: row(5),
    sm: row(3),
    xs: [item(ids[0], 0, 0, 2), item(ids[1], 0, 5, 2), item(ids[2], 0, 10, 2)],
  };
  const patch = await request.patch(`/api/dashboards/${dashboardId}/update`, {
    data: { fields: ["layout"], dashboard: { layout } },
    headers: json,
  });
  expect(patch.status(), await patch.text()).toBe(200);
  return dashboardId;
}

test("waitForPanelGrid returns only once the real grid is up and the skeleton has unmounted", async ({
  page,
  request,
}) => {
  await registerAndLogin(page, request, { ...AUTH, isolate: true });
  const dashboardId = await seedDashboard(page.request);
  await page.setViewportSize({ width: 1600, height: 1000 });

  // Stretch only the skeleton layer's fade. The selector outranks Crossfade.css; `!important` makes it certain.
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
  // screen, fade stretched) while it is waiting.
  const ready = waitForPanelGrid(page, PANEL_COUNT, { timeout: 15_000 });
  await Promise.all([
    ready,
    (async () => {
      await expect(page.locator(".crossfade__skeleton .react-grid-item").first()).toBeAttached();
      await expect(page.locator(".crossfade__skeleton")).toHaveCSS("transition-duration", "3s");
    })(),
  ]);

  // One-shot reads only: no retry may paper over a helper that returned too early.
  const items = await page.locator(".react-grid-item").count();
  const skeletons = await page.getByLabel("Loading panels").count();
  const boxes = await page.locator(".react-grid-item").evaluateAll((els) =>
    els.map((el) => ({
      w: el.getBoundingClientRect().width,
      h: el.getBoundingClientRect().height,
    })),
  );
  expect(items, "no skeleton stub is left among the grid items").toBe(PANEL_COUNT);
  expect(skeletons, "the loading skeleton has unmounted").toBe(0);
  expect(boxes.length).toBe(PANEL_COUNT);
  for (const box of boxes) {
    expect(box.w).toBeGreaterThan(0);
    expect(box.h).toBeGreaterThan(0);
  }
});
