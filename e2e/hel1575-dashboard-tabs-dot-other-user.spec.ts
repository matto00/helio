import { expect, test } from "@playwright/test";

import { CSRF_HEADER } from "./support/auth";
import {
  dotOf,
  expectTableRendered,
  openThreeTabs,
  refreshSignals,
  secondContext,
  tabNamed,
} from "./support/hel1575-dashboard-tabs";

// HEL-1575 -- another user's edit marks, the own session never marks itself.
// One of the `hel1575-dashboard-tabs-*.spec.ts` parts (HEL-1789 split the spec so CI's file-level sharding can place them on
// different legs); the shared helpers, the seeding and the rationale live in support/hel1575-dashboard-tabs.ts.
// Every test registers its own user and seeds its own dashboards, so the parts share no state.

test.describe.configure({ mode: "parallel" });

test.describe("HEL-1575 changed dot and own edits", () => {
  test.setTimeout(180_000);

  test("another user's edit would mark; the own session never marks itself (content edit by API from a second session)", async ({
    page,
    request,
    browser,
  }) => {
    // The same user editing from another device is a content change this device did not make.
    const ws = await openThreeTabs(page, request);
    await tabNamed(page, "Tabs B").click();
    await expectTableRendered(page, "Tabs B");
    await refreshSignals(page);
    await expect(dotOf(page, ws.dashboards["Tabs A"])).toHaveCount(0);

    const other = await secondContext(browser, page);
    try {
      const res = await other.request.patch(`/api/panels/${ws.panels["Tabs A"].noteId}`, {
        data: { title: "Tabs A from another device" },
        headers: { [CSRF_HEADER]: "1" },
      });
      expect(res.status()).toBeLessThan(300);
    } finally {
      await other.close();
    }
    await refreshSignals(page);
    await expect(dotOf(page, ws.dashboards["Tabs A"])).toHaveCount(1);
  });
});
