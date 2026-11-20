import { expect, test } from "@playwright/test";

import { CSRF_HEADER } from "./support/auth";
import {
  expectSaved,
  openThreeTabs,
  savedTabs,
  secondContext,
} from "./support/hel1575-dashboard-tabs";

// HEL-1575 -- the 125 s idle two-device test.
// One of the `hel1575-dashboard-tabs-*.spec.ts` parts (HEL-1789 split the spec so CI's file-level sharding can place them on
// different legs); the shared helpers, the seeding and the rationale live in support/hel1575-dashboard-tabs.ts.
// Every test registers its own user and seeds its own dashboards, so the parts share no state.

test.describe.configure({ mode: "parallel" });

test.describe("HEL-1575 dashboard tabs", () => {
  test.setTimeout(180_000);

  test("an idle, visible device never overwrites the tab set another device saved (two devices, 125 s idle)", async ({
    page,
    request,
    browser,
  }) => {
    test.setTimeout(240_000);
    const ws = await openThreeTabs(page, request);
    // Wait for A's OWN last write, the whole three-tab set, not just the active id: the first
    // coalesced PATCH already carries the right active id with one tab, so waiting on that alone
    // let A's later 1 s coalesced PATCH of the tabs it opened land after B's save (CI 38834564117).
    await expectSaved(
      page,
      [ws.dashboards["Tabs A"], ws.dashboards["Tabs B"], ws.dashboards["Tabs C"]],
      ws.dashboards["Tabs A"],
    );

    // Device B (a second context, same user) closes two tabs; device A stays open, visible and untouched.
    const deviceB = await secondContext(browser, page);
    try {
      const only = { id: ws.dashboards["Tabs A"], lastViewedAt: new Date().toISOString() };
      const res = await deviceB.request.patch("/api/users/me/preferences", {
        data: { dashboardTabs: { tabs: [only], activeId: only.id } },
        headers: { [CSRF_HEADER]: "1" },
      });
      expect(res.status()).toBe(200);
      expect(await savedTabs(page)).toEqual({ ids: [only.id], activeId: only.id });

      const patches: string[] = [];
      page.on("request", (r) => {
        if (r.method() === "PATCH" && r.url().includes("/api/users/me/preferences")) {
          patches.push(r.url());
        }
      });
      // More than two 60 s heartbeats of an idle, visible page.
      for (let elapsed = 0; elapsed < 125_000; elapsed += 25_000) {
        await page.waitForTimeout(25_000);
        expect(await savedTabs(page), `device B's set at +${elapsed + 25_000} ms`).toEqual({
          ids: [only.id],
          activeId: only.id,
        });
      }
      expect(patches, "preferences PATCHes sent by the idle device").toEqual([]);
    } finally {
      await deviceB.close();
    }
  });
});
