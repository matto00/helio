import { expect, test } from "@playwright/test";

import { registerAndLogin } from "./support/auth";
import { seedWorld } from "./support/motionPrimitivesSeed";
import { waitForPanelGrid } from "./support/panelGridReady";

// HEL-1657 -- a layout-only save (a drag, no panel edit) must refresh the meta row's "Last saved" label.

test.use({ viewport: { width: 1280, height: 900 } });

test("a drag-only save shows 'Last saved just now' in the meta row", async ({ page, request }) => {
  await registerAndLogin(page, request, {
    prefix: "hel1657",
    displayName: "HEL-1657",
    label: "layout-save",
    isolate: true,
  });
  const world = await seedWorld(request, "L-1657");

  const panelBatchSaves: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && new URL(req.url()).pathname === "/api/panels/updateBatch") {
      panelBatchSaves.push(req.url());
    }
  });

  await page.goto(`/dashboards/${world.dashboardId}`);
  await waitForPanelGrid(page, 3);
  await page.getByRole("button", { name: "Edit layout" }).click();
  await expect(page.locator(".panel-grid--editing")).toBeVisible();

  const item = page.locator(".panel-grid > .react-grid-item").filter({ hasText: "Metric" }).first();
  await item.scrollIntoViewIfNeeded();
  const box = (await item.locator(".panel-grid-card__handle").boundingBox())!;
  const hx = box.x + box.width / 2;
  const hy = box.y + box.height / 2;
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  await page.mouse.move(hx + 30, hy + 8, { steps: 4 });
  await page.mouse.move(hx + 140, hy + 8, { steps: 6 });
  await page.mouse.up();

  const label = page.locator(".save-state-indicator__label");
  await expect(label).toContainText("Unsaved changes");
  const saved = page.waitForResponse(
    (res) =>
      res.request().method() === "PATCH" &&
      /\/api\/dashboards\/[^/]+(\/update)?$/.test(new URL(res.url()).pathname) &&
      res.ok(),
  );
  await page.getByRole("button", { name: "Save now" }).click();
  await saved;

  await expect(label).toContainText("Last saved just now");
  expect(panelBatchSaves).toEqual([]);
});
