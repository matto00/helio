import { expect, test } from "@playwright/test";

import {
  dotOf,
  dragFirstCardDown,
  expectSavedActive,
  expectTableRendered,
  openOtherDevice,
  openThreeTabs,
  PANELS,
  post,
  recorder,
  refreshSignals,
  renamePanel,
  ROWS,
  runPipeline,
  secondContext,
  tabById,
  tabNamed,
} from "./support/hel1575-dashboard-tabs";

// HEL-1575 -- the changed-dot tests: drag/rename stay warm, a run while the tab is away marks it.
// One of the `hel1575-dashboard-tabs-*.spec.ts` parts (HEL-1789 split the spec so CI's file-level sharding can place them on
// different legs); the shared helpers, the seeding and the rationale live in support/hel1575-dashboard-tabs.ts.
// Every test registers its own user and seeds its own dashboards, so the parts share no state.

test.describe.configure({ mode: "parallel" });

test.describe("HEL-1575 changed dot and own edits", () => {
  test.setTimeout(180_000);

  test("a dragged panel: switch and return is warm with no dot, also after a reload and in a second context", async ({
    page,
    request,
    browser,
  }) => {
    const ws = await openThreeTabs(page, request);
    await dragFirstCardDown(page);
    const net = recorder(page);

    await tabNamed(page, "Tabs B").click();
    await expectTableRendered(page, "Tabs B");
    await refreshSignals(page);
    await expect(dotOf(page, ws.dashboards["Tabs A"])).toHaveCount(0);

    // Return: warm, so neither the panel list nor a rows request, and no dot.
    const from = net.mark();
    await tabNamed(page, "Tabs A").click();
    await expectTableRendered(page, "Tabs A");
    await page.waitForTimeout(1_500);
    expect(net.since(from, PANELS)).toEqual([]);
    expect(net.since(from, ROWS)).toEqual([]);
    await expect(dotOf(page, ws.dashboards["Tabs A"])).toHaveCount(0);

    // Leave again, then reload within the TTL: still no dot, still warm.
    await tabNamed(page, "Tabs B").click();
    await expectTableRendered(page, "Tabs B");
    await expectSavedActive(page, ws.dashboards["Tabs B"]);
    const reloadFrom = net.mark();
    await page.goto("/dashboards"); // a fresh document; the URL of a deep-linked start would beat the saved active tab
    await expectTableRendered(page, "Tabs B");
    await refreshSignals(page);
    await expect(dotOf(page, ws.dashboards["Tabs A"])).toHaveCount(0);
    await expect(dotOf(page, ws.dashboards["Tabs C"])).toHaveCount(0);
    expect(net.since(reloadFrom, PANELS)).toEqual([]);

    // Another device: its tab for A has no dot either (the own write is saved with the tab set).
    const other = await secondContext(browser, page);
    try {
      const second = await openOtherDevice(other);
      await expect(second.locator(".dashboard-tab__dot")).toHaveCount(0);
    } finally {
      await other.close();
    }
  });

  test("a renamed panel: switch and return is warm with no dot, also after a reload and in a second context", async ({
    page,
    request,
    browser,
  }) => {
    const ws = await openThreeTabs(page, request);
    await renamePanel(page, "Tabs A note", "Tabs A renamed");
    const net = recorder(page);

    await tabNamed(page, "Tabs B").click();
    await expectTableRendered(page, "Tabs B");
    await refreshSignals(page);
    await expect(dotOf(page, ws.dashboards["Tabs A"])).toHaveCount(0);

    const from = net.mark();
    await tabNamed(page, "Tabs A").click();
    await expect(page.getByRole("heading", { name: "Tabs A renamed" })).toBeVisible();
    await expectTableRendered(page, "Tabs A");
    await page.waitForTimeout(1_500);
    expect(net.since(from, PANELS)).toEqual([]);
    expect(net.since(from, ROWS)).toEqual([]);
    await expect(dotOf(page, ws.dashboards["Tabs A"])).toHaveCount(0);

    await tabNamed(page, "Tabs B").click();
    await expectTableRendered(page, "Tabs B");
    await expectSavedActive(page, ws.dashboards["Tabs B"]);
    await page.goto("/dashboards"); // a fresh document; the URL of a deep-linked start would beat the saved active tab
    await expectTableRendered(page, "Tabs B");
    await refreshSignals(page);
    await expect(dotOf(page, ws.dashboards["Tabs A"])).toHaveCount(0);

    const other = await secondContext(browser, page);
    try {
      const second = await openOtherDevice(other);
      await expect(second.locator(".dashboard-tab__dot")).toHaveCount(0);
    } finally {
      await other.close();
    }
  });

  test("a run while the tab is active, then leave and return within the TTL: still warm", async ({
    page,
    request,
  }) => {
    const ws = await openThreeTabs(page, request);
    const net = recorder(page);
    await runPipeline(request, ws.pipelines["Tabs A"]);
    // The active dashboard's cards pick the run up through the run-event fan-out.
    await expect
      .poll(() => net.since(0, ROWS).length, { timeout: 20_000 })
      .toBeGreaterThanOrEqual(1);
    await expectTableRendered(page, "Tabs A");
    await page.waitForTimeout(1_000);

    await tabNamed(page, "Tabs B").click();
    await expectTableRendered(page, "Tabs B");
    const from = net.mark();
    await tabNamed(page, "Tabs A").click();
    await expectTableRendered(page, "Tabs A");
    await page.waitForTimeout(1_500);
    expect(net.since(from, PANELS), "run while active must not void warmth").toEqual([]);
    expect(net.since(from, ROWS)).toEqual([]);
  });

  test("a run while the tab is away marks it with a dot, refreshes its rows on return without a panel-list request, and the dot clears", async ({
    page,
    request,
  }) => {
    const ws = await openThreeTabs(page, request);
    await tabNamed(page, "Tabs B").click();
    await expectTableRendered(page, "Tabs B");
    await refreshSignals(page);
    await expect(dotOf(page, ws.dashboards["Tabs A"])).toHaveCount(0);

    // The source gains a row, so the run changes what the panel shows.
    await post(request, `/api/data-sources/${ws.sources["Tabs A"]}/rows`, {
      rows: [["North", 70]],
    });
    await runPipeline(request, ws.pipelines["Tabs A"]);
    await refreshSignals(page);
    await expect(dotOf(page, ws.dashboards["Tabs A"])).toHaveCount(1);
    await expect(dotOf(page, ws.dashboards["Tabs B"])).toHaveCount(0);
    await expect(dotOf(page, ws.dashboards["Tabs C"])).toHaveCount(0);
    await expect(tabById(page, ws.dashboards["Tabs A"])).toHaveAccessibleName(
      "Tabs A, changed since you last viewed",
    );

    const net = recorder(page);
    await tabNamed(page, "Tabs A").click();
    await expectTableRendered(page, "Tabs A");
    // The new data shows after the cards reconcile the run.
    await expect(
      page
        .locator(".panel-grid-card", { hasText: "Tabs A table" })
        .getByRole("cell", { name: "North", exact: true }),
    ).toBeVisible();
    await expect(dotOf(page, ws.dashboards["Tabs A"])).toHaveCount(0);
    // The warm panels are kept; the cards reconcile the run (rows) themselves.
    expect(net.all().filter((c) => PANELS.test(c))).toEqual([]);
    await expect.poll(() => net.all().filter((c) => ROWS.test(c)).length).toBeGreaterThanOrEqual(1);
  });
});
