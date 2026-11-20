import { expect, test } from "@playwright/test";

import {
  dotOf,
  expectSavedActive,
  expectTableRendered,
  openThreeTabs,
  recorder,
  refreshSignals,
  renamePanel,
  ROWS,
  runPipeline,
  tabNamed,
  warmEntryCount,
} from "./support/hel1575-dashboard-tabs";

// HEL-1575 -- own edit then a run, and data changed before a reload.
// One of the `hel1575-dashboard-tabs-*.spec.ts` parts (HEL-1789 split the spec so CI's file-level sharding can place them on
// different legs); the shared helpers, the seeding and the rationale live in support/hel1575-dashboard-tabs.ts.
// Every test registers its own user and seeds its own dashboards, so the parts share no state.

test.describe.configure({ mode: "parallel" });

test.describe("HEL-1575 changed dot and own edits", () => {
  test.setTimeout(180_000);

  test("own edit, leave, then a run: the dot shows (own edits never hide new data)", async ({
    page,
    request,
  }) => {
    const ws = await openThreeTabs(page, request);
    await renamePanel(page, "Tabs A note", "Tabs A edited");
    await tabNamed(page, "Tabs B").click();
    await expectTableRendered(page, "Tabs B");
    await refreshSignals(page);
    await expect(dotOf(page, ws.dashboards["Tabs A"])).toHaveCount(0);

    await runPipeline(request, ws.pipelines["Tabs A"]);
    await refreshSignals(page);
    await expect(dotOf(page, ws.dashboards["Tabs A"])).toHaveCount(1);
  });

  test("data changed before a reload: the restored tab refetches its rows instead of showing the old ones", async ({
    page,
    request,
  }) => {
    const ws = await openThreeTabs(page, request);
    await tabNamed(page, "Tabs B").click();
    await expectTableRendered(page, "Tabs B");
    await expect.poll(() => warmEntryCount(page)).toBeGreaterThanOrEqual(1);
    await runPipeline(request, ws.pipelines["Tabs B"]);
    await expectSavedActive(page, ws.dashboards["Tabs B"]);
    const net = recorder(page);
    await page.goto("/dashboards"); // a fresh document; the URL of a deep-linked start would beat the saved active tab
    await expectTableRendered(page, "Tabs B");
    await expect.poll(() => net.all().filter((c) => ROWS.test(c)).length).toBeGreaterThanOrEqual(1);
  });
});
