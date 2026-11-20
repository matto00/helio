import { expect, test } from "@playwright/test";

import { currentUserId, registerAndLogin, registerUser } from "./support/auth";
import { setUserTierForTest } from "./support/historySeed";
import { loginThenIsolate } from "./support/isolateLivePage";
import {
  askFromPalette,
  AUTH,
  ctrlOpen,
  expectSaved,
  expectSavedActive,
  expectTableRendered,
  list,
  NAMES,
  openThreeTabs,
  PANELS,
  recorder,
  ROWS,
  secondContext,
  seedWorkspace,
  stubConverse,
  tablist,
  tabNamed,
  tabOrder,
  VIEWPORT,
  warmEntryCount,
  warmEntryCountAfterSignOut,
} from "./support/hel1575-dashboard-tabs";

// HEL-1575 -- dashboard tabs (open/replace/close/reorder, warm cache, logout wipe) and the palette ask box.
// One of the `hel1575-dashboard-tabs-*.spec.ts` parts (HEL-1789 split the spec so CI's file-level sharding can place them on
// different legs); the shared helpers, the seeding and the rationale live in support/hel1575-dashboard-tabs.ts.
// Every test registers its own user and seeds its own dashboards, so the parts share no state.

test.describe.configure({ mode: "parallel" });

test.describe("HEL-1575 dashboard tabs", () => {
  test.setTimeout(180_000);

  test("open, activate, replace, close and reorder by mouse and keyboard; the order survives a reload", async ({
    page,
    request,
  }) => {
    await page.setViewportSize(VIEWPORT);
    await registerAndLogin(page, request, AUTH);
    const ws = await seedWorkspace(request);
    await page.goto(`/dashboards/${ws.dashboards["Tabs A"]}`);
    await expectTableRendered(page, "Tabs A");
    await expect(tablist(page)).toBeVisible();
    expect(await tabOrder(page)).toEqual(["Tabs A"]);

    // Ctrl-click opens a background tab: no navigation, selection unchanged.
    // A background tab opens right after the active one: opening C then B gives A, B, C.
    await ctrlOpen(page, "Tabs C");
    await ctrlOpen(page, "Tabs B");
    expect(await tabOrder(page)).toEqual(["Tabs A", "Tabs B", "Tabs C"]);
    await expect(tabNamed(page, "Tabs A")).toHaveAttribute("aria-selected", "true");

    // A middle-click opens a background tab too (a duplicate opens nothing new).
    await list(page)
      .getByRole("button", { name: "Tabs B", exact: true })
      .click({ button: "middle" });
    expect(await tabOrder(page)).toEqual(["Tabs A", "Tabs B", "Tabs C"]);

    // Clicking an open tab activates it and navigates.
    await tabNamed(page, "Tabs B").click();
    await expect(tabNamed(page, "Tabs B")).toHaveAttribute("aria-selected", "true");
    await expectTableRendered(page, "Tabs B");

    // Keyboard reorder: Alt+Shift+Right moves the focused tab one place and keeps focus on it.
    await tabNamed(page, "Tabs B").focus();
    await page.keyboard.press("Alt+Shift+ArrowRight");
    expect(await tabOrder(page)).toEqual(["Tabs A", "Tabs C", "Tabs B"]);
    await expect(tabNamed(page, "Tabs B")).toBeFocused();
    await page.keyboard.press("Alt+Shift+ArrowLeft");
    await page.keyboard.press("Alt+Shift+ArrowLeft");
    expect(await tabOrder(page)).toEqual(["Tabs B", "Tabs A", "Tabs C"]);

    // Mouse reorder: drag C onto the left half of B.
    const wrapper = (name: string) => page.locator(".dashboard-tab", { hasText: name });
    await wrapper("Tabs C").dragTo(wrapper("Tabs B"), { targetPosition: { x: 4, y: 12 } });
    expect(await tabOrder(page)).toEqual(["Tabs C", "Tabs B", "Tabs A"]);

    // Reload: the saved order and the active tab come back.
    await expectSaved(
      page,
      [ws.dashboards["Tabs C"], ws.dashboards["Tabs B"], ws.dashboards["Tabs A"]],
      ws.dashboards["Tabs B"],
    );
    await page.goto("/dashboards"); // a fresh document; the URL of a deep-linked start would beat the saved active tab
    await expect(tablist(page)).toBeVisible();
    expect(await tabOrder(page)).toEqual(["Tabs C", "Tabs B", "Tabs A"]);
    await expect(tabNamed(page, "Tabs B")).toHaveAttribute("aria-selected", "true");

    // Keyboard close: Delete closes the focused (active) tab; the right neighbour becomes active.
    await tabNamed(page, "Tabs B").focus();
    await page.keyboard.press("Delete");
    expect(await tabOrder(page)).toEqual(["Tabs C", "Tabs A"]);
    await expect(tabNamed(page, "Tabs A")).toHaveAttribute("aria-selected", "true");
    await expectTableRendered(page, "Tabs A");

    // Pointer close of an inactive tab leaves the active one alone.
    await page.locator('button[title="Close Tabs C"]').click({ force: true });
    expect(await tabOrder(page)).toEqual(["Tabs A"]);
    await expect(tabNamed(page, "Tabs A")).toHaveAttribute("aria-selected", "true");

    // Closing the last tab shows the empty state, and it stays empty after a reload.
    await tabNamed(page, "Tabs A").focus();
    await page.keyboard.press("Delete");
    await expect(page.getByText("No dashboard open")).toBeVisible();
    await expect(page.locator(".dashboard-tab")).toHaveCount(0);
    await expectSaved(page, [], null);
    await page.goto("/dashboards");
    await expect(page.locator(".dashboard-tab")).toHaveCount(0);
  });

  test("touch: a tap on a tab's left edge lands in that tab, not on the previous tab's close expander", async ({
    browser,
    request,
  }) => {
    const context = await browser.newContext({
      baseURL: test.info().project.use.baseURL,
      viewport: VIEWPORT,
      hasTouch: true,
    });
    try {
      const page = await context.newPage();
      await registerAndLogin(page, request, AUTH);
      const ws = await seedWorkspace(request);
      await page.goto(`/dashboards/${ws.dashboards["Tabs A"]}`);
      await expectTableRendered(page, "Tabs A");
      await ctrlOpen(page, "Tabs C");
      await ctrlOpen(page, "Tabs B");
      await expect(page.locator(".dashboard-tab")).toHaveCount(3);
      expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
      const hits = await page.evaluate(() => {
        const tabs = [...document.querySelectorAll<HTMLElement>(".dashboard-tab")];
        return tabs.slice(1).map((tab) => {
          const box = tab.getBoundingClientRect();
          const hit = document.elementFromPoint(box.left + 0.5, box.top + box.height / 2);
          return hit?.closest(".dashboard-tab") === tab;
        });
      });
      expect(hits).toEqual([true, true]);
    } finally {
      await context.close();
    }
  });

  test("a plain list click replaces the active tab and keeps the others", async ({
    page,
    request,
  }) => {
    await page.setViewportSize(VIEWPORT);
    await registerAndLogin(page, request, AUTH);
    const ws = await seedWorkspace(request);
    await page.goto(`/dashboards/${ws.dashboards["Tabs A"]}`);
    await expectTableRendered(page, "Tabs A");
    await ctrlOpen(page, "Tabs B");
    await list(page).getByRole("button", { name: "Tabs C", exact: true }).click();
    await expectTableRendered(page, "Tabs C");
    expect(await tabOrder(page)).toEqual(["Tabs C", "Tabs B"]);
    await expect(tabNamed(page, "Tabs C")).toHaveAttribute("aria-selected", "true");
  });

  test("open-tab mode: the + button opens the palette listing dashboards, and a pick opens a new active tab", async ({
    page,
    request,
  }) => {
    await page.setViewportSize(VIEWPORT);
    await registerAndLogin(page, request, AUTH);
    const ws = await seedWorkspace(request);
    await page.goto(`/dashboards/${ws.dashboards["Tabs A"]}`);
    await expectTableRendered(page, "Tabs A");

    await page.getByRole("button", { name: "Open a dashboard in a new tab" }).click();
    const dialog = page.getByRole("dialog");
    const search = dialog.getByRole("combobox", { name: "Search dashboards" });
    await expect(search).toBeVisible();
    await expect(search).toHaveAttribute("placeholder", "Open a dashboard in a new tab");
    // Dashboards only, every one listed for an empty query; no Ask action.
    for (const name of NAMES) {
      await expect(dialog.getByRole("option", { name: new RegExp(name) })).toBeVisible();
    }
    await search.fill("Tabs C");
    await expect(dialog.getByRole("option", { name: /Ask the assistant/ })).toHaveCount(0);
    await dialog.getByRole("option", { name: /Tabs C/ }).click();
    await expectTableRendered(page, "Tabs C");
    expect(await tabOrder(page)).toEqual(["Tabs A", "Tabs C"]);
    await expect(tabNamed(page, "Tabs C")).toHaveAttribute("aria-selected", "true");
  });

  test("a /dashboards/:id deep link beats the saved active tab, with no panel request for another dashboard", async ({
    page,
    request,
  }) => {
    const ws = await openThreeTabs(page, request);
    await tabNamed(page, "Tabs C").click();
    await expectTableRendered(page, "Tabs C");
    await expectSavedActive(page, ws.dashboards["Tabs C"]);

    const net = recorder(page);
    await page.goto(`/dashboards/${ws.dashboards["Tabs A"]}`);
    await expect(tabNamed(page, "Tabs A")).toHaveAttribute("aria-selected", "true");
    await expectTableRendered(page, "Tabs A");
    expect(await tabOrder(page)).toEqual(["Tabs A", "Tabs B", "Tabs C"]);
    const panelRequests = net.all().filter((c) => PANELS.test(c));
    for (const request of panelRequests) {
      expect(request, "only the deep-linked dashboard may load panels").toContain(
        ws.dashboards["Tabs A"],
      );
    }
    expect(net.all().some((c) => c.includes(ws.dashboards["Tabs C"]) && PANELS.test(c))).toBe(
      false,
    );
    expect(net.all().some((c) => c.includes(ws.dashboards["Tabs B"]) && PANELS.test(c))).toBe(
      false,
    );
  });

  test("deleting an open dashboard: the active one moves to its neighbour, an inactive one just loses its tab", async ({
    page,
    request,
  }) => {
    await openThreeTabs(page, request);
    await tabNamed(page, "Tabs B").click();
    await expectTableRendered(page, "Tabs B");

    const deleteFromList = async (name: string) => {
      // The kebab is revealed on row hover.
      await list(page).getByRole("button", { name, exact: true }).hover();
      await list(page)
        .getByRole("button", { name: `${name} actions` })
        .click();
      await page.getByRole("menuitem", { name: "Delete" }).click();
      await list(page).getByRole("button", { name: "Confirm" }).click();
    };

    await deleteFromList("Tabs B");
    await expect.poll(() => tabOrder(page)).toEqual(["Tabs A", "Tabs C"]);
    await expect(tabNamed(page, "Tabs C")).toHaveAttribute("aria-selected", "true");
    await expectTableRendered(page, "Tabs C");

    await deleteFromList("Tabs A");
    await expect.poll(() => tabOrder(page)).toEqual(["Tabs C"]);
    await expect(tabNamed(page, "Tabs C")).toHaveAttribute("aria-selected", "true");
  });

  test("a warm switch makes no panel-list or rows request; reload within the TTL is warm; a second context restores the tabs", async ({
    page,
    request,
    browser,
  }) => {
    const ws = await openThreeTabs(page, request);
    const net = recorder(page);

    let from = net.mark();
    await tabNamed(page, "Tabs B").click();
    await expectTableRendered(page, "Tabs B");
    await tabNamed(page, "Tabs C").click();
    await expectTableRendered(page, "Tabs C");
    await tabNamed(page, "Tabs A").click();
    await expectTableRendered(page, "Tabs A");
    await page.waitForTimeout(1_500);
    expect(net.since(from, PANELS), "warm switch: panel list requests").toEqual([]);
    expect(net.since(from, ROWS), "warm switch: rows requests").toEqual([]);

    // Reload within the TTL: the active dashboard comes from the browser-stored copy.
    await expect.poll(() => warmEntryCount(page)).toBeGreaterThanOrEqual(2);
    await expectSavedActive(page, ws.dashboards["Tabs A"]);
    from = net.mark();
    await page.reload();
    await expectTableRendered(page, "Tabs A");
    await expect(tabNamed(page, "Tabs A")).toHaveAttribute("aria-selected", "true");
    await page.waitForTimeout(1_500);
    expect(net.since(from, PANELS), "reload within TTL: panel list requests").toEqual([]);
    expect(net.since(from, ROWS), "reload within TTL: rows requests").toEqual([]);
    // ...and so is a lazily restored other tab.
    from = net.mark();
    await tabNamed(page, "Tabs B").click();
    await expectTableRendered(page, "Tabs B");
    await page.waitForTimeout(1_000);
    expect(net.since(from, PANELS), "restored tab B: panel list requests").toEqual([]);
    expect(net.since(from, ROWS), "restored tab B: rows requests").toEqual([]);
    await expectSavedActive(page, ws.dashboards["Tabs B"]);

    // A second browser context (another device): same tabs, same order, same active tab, and it loads fine.
    const other = await secondContext(browser, page);
    try {
      const second = await other.newPage();
      await second.goto("/dashboards");
      await expect(tablist(second)).toBeVisible();
      expect(await tabOrder(second)).toEqual(["Tabs A", "Tabs B", "Tabs C"]);
      await expect(tabNamed(second, "Tabs B")).toHaveAttribute("aria-selected", "true");
      await expectTableRendered(second, "Tabs B");
    } finally {
      await other.close();
    }
  });

  test("an expired tab (16 minutes) refetches its panels", async ({ page, request }) => {
    await page.setViewportSize(VIEWPORT);
    await page.clock.install({ time: new Date() });
    await registerAndLogin(page, request, AUTH);
    const ws = await seedWorkspace(request);
    await page.goto(`/dashboards/${ws.dashboards["Tabs A"]}`);
    await expectTableRendered(page, "Tabs A");
    await ctrlOpen(page, "Tabs B");
    await tabNamed(page, "Tabs B").click();
    await expectTableRendered(page, "Tabs B");
    const net = recorder(page);

    // Within the TTL: warm.
    let from = net.mark();
    await tabNamed(page, "Tabs A").click();
    await expectTableRendered(page, "Tabs A");
    await page.waitForTimeout(800);
    expect(net.since(from, PANELS)).toEqual([]);

    // Past it: B was left 16 minutes ago, so the switch refetches its panels.
    await tabNamed(page, "Tabs B").click();
    await expectTableRendered(page, "Tabs B");
    await tabNamed(page, "Tabs A").click();
    await expectTableRendered(page, "Tabs A");
    // HEL-1681 item 5: the app measures its server-clock offset as `serverNow - Date.now()` on every change-signals response
    // (HEL-1575 D4/D7). `fastForward` jumps only the CLIENT clock and also fires the signals poll; a response that lands
    // after the jump would measure an offset of -16 minutes and cancel it, so the tab would no longer be expired by the
    // time of the click (the request-after-click race made this test fail about 1 run in 8 under 2 workers). Real time
    // passing would move the server's clock too: shift `serverNow` by the same 16 minutes once the jump has happened.
    let jumped = false;
    await page.route("**/api/dashboard-changes**", async (route) => {
      const response = await route.fetch();
      if (!jumped) return route.fulfill({ response });
      const body = await response.json();
      body.serverNow = new Date(Date.parse(body.serverNow) + 16 * 60_000).toISOString();
      return route.fulfill({ response, json: body });
    });
    jumped = true;
    await page.clock.fastForward("16:00");
    from = net.mark();
    await tabNamed(page, "Tabs B").click();
    await expect.poll(() => net.since(from, PANELS).length).toBeGreaterThanOrEqual(1);
    expect(net.since(from, PANELS)[0]).toContain(ws.dashboards["Tabs B"]);
    await expectTableRendered(page, "Tabs B");
    // Expired means the rows too, not only the panel list.
    await expect.poll(() => net.since(from, ROWS).length).toBeGreaterThanOrEqual(1);
  });

  test("logout clears the browser-stored warm copy", async ({ page, request }) => {
    await openThreeTabs(page, request);
    await expect.poll(() => warmEntryCount(page)).toBeGreaterThanOrEqual(1);
    await page.getByRole("button", { name: "User menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await page.waitForURL("/login");
    // The database is deleted, or, if a browser keeps the shell, holds no entries.
    await expect.poll(() => warmEntryCountAfterSignOut(page)).toBe(0);
  });

  test("logout with an already-expired session (the sign-out request answers 401) still clears the warm copy", async ({
    page,
    request,
  }) => {
    await openThreeTabs(page, request);
    await expect.poll(() => warmEntryCount(page)).toBeGreaterThanOrEqual(1);
    await page.route("**/api/auth/logout", (route) =>
      route.fulfill({ status: 401, json: { message: "Unauthorized" } }),
    );
    await page.getByRole("button", { name: "User menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await page.waitForURL("/login");
    // The 401 interceptor hard-navigates to /login on top of the SPA's own redirect.
    await expect.poll(() => warmEntryCountAfterSignOut(page)).toBe(0);
  });

  test("reload of the only, never-left dashboard is warm: no panel list or rows request", async ({
    page,
    request,
  }) => {
    await page.setViewportSize(VIEWPORT);
    await registerAndLogin(page, request, AUTH);
    const ws = await seedWorkspace(request, ["Tabs A"]);
    const net = recorder(page);
    await page.goto(`/dashboards/${ws.dashboards["Tabs A"]}`);
    await expectTableRendered(page, "Tabs A");
    // Never switch tabs: the active tab's copy must reach the browser store on its own, without pagehide.
    await expect.poll(() => warmEntryCount(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(1);

    const from = net.mark();
    await page.reload();
    await expectTableRendered(page, "Tabs A");
    await page.waitForTimeout(1_500);
    expect(net.since(from, PANELS), "reload of the active dashboard: panel list requests").toEqual(
      [],
    );
    expect(net.since(from, ROWS), "reload of the active dashboard: rows requests").toEqual([]);
  });
});

test.describe("HEL-1575 palette box and ask handoff", () => {
  test.setTimeout(120_000);

  test("the Search, jump, or ask box opens the palette", async ({ page, request }) => {
    await page.setViewportSize(VIEWPORT);
    await registerAndLogin(page, request, AUTH);
    const ws = await seedWorkspace(request);
    await page.goto(`/dashboards/${ws.dashboards["Tabs A"]}`);
    await expectTableRendered(page, "Tabs A");
    const box = page.getByRole("button", { name: "Search, jump, or ask" });
    await expect(box).toBeVisible();
    await expect(box).toHaveAttribute("aria-keyshortcuts", /^(Control|Meta)\+K$/);
    await box.click();
    const search = page.getByRole("dialog").getByRole("combobox", { name: "Search commands" });
    await expect(search).toBeVisible();
    await expect(search).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(search).toBeHidden();
  });

  test("Ask the assistant hands the text to /chat and sends exactly one converse request", async ({
    page,
    request,
  }) => {
    await page.setViewportSize(VIEWPORT);
    const credentials = await registerUser(request, {
      prefix: "hel1575ask",
      displayName: "HEL-1575",
    });
    const userId = await currentUserId(request);
    console.log(
      `[HEL-1575 e2e] created user ${userId}; tier set for ${setUserTierForTest(userId, "beta")}`,
    );
    await loginThenIsolate(page, credentials);
    const ws = await seedWorkspace(request, ["Tabs A"]);

    // No real Claude call, no quota: the converse route is answered here. Conversation creation stays real.
    const converseBodies = await stubConverse(page);

    await page.goto(`/dashboards/${ws.dashboards["Tabs A"]}`);
    await expectTableRendered(page, "Tabs A");
    await page.getByRole("button", { name: "Search, jump, or ask" }).click();
    const search = page.getByRole("dialog").getByRole("combobox", { name: "Search commands" });
    await search.fill("zzqx show me revenue by region");
    const ask = page.getByRole("option", {
      name: /Ask the assistant: "zzqx show me revenue by region"/,
    });
    await expect(ask).toBeVisible();
    // The Ask action is the last one in the list.
    const options = page.getByRole("dialog").getByRole("option");
    await expect(options.last()).toHaveText(/Ask the assistant/);
    await ask.click();

    await expect(page).toHaveURL(/\/chat$/);
    await expect(page.getByText("stubbed reply")).toBeVisible();
    await page.waitForTimeout(1_000);
    expect(converseBodies).toEqual(["zzqx show me revenue by region"]);
  });

  test("Ask the assistant while already on /chat sends once per ask, and a reload sends nothing", async ({
    page,
    request,
  }) => {
    await page.setViewportSize(VIEWPORT);
    const credentials = await registerUser(request, {
      prefix: "hel1575chat",
      displayName: "HEL-1575",
    });
    const userId = await currentUserId(request);
    console.log(
      `[HEL-1575 e2e] created user ${userId}; tier set for ${setUserTierForTest(userId, "beta")}`,
    );
    await loginThenIsolate(page, credentials);
    const converseBodies = await stubConverse(page);
    const creates: string[] = [];
    page.on("request", (r) => {
      const url = new URL(r.url());
      if (r.method() === "POST" && url.pathname === "/api/assistant-conversations") {
        creates.push(url.pathname);
      }
    });

    await page.goto("/chat");
    await expect(page.getByLabel("Message")).toBeVisible();
    await askFromPalette(page, "zzqx first question");
    await expect(page.getByText("stubbed reply")).toBeVisible();
    expect(converseBodies).toEqual(["zzqx first question"]);
    expect(creates).toHaveLength(1);

    // Already on /chat: the same route, no remount -- the hand-off must still be honoured, once.
    await askFromPalette(page, "zzqx second question");
    await expect
      .poll(() => converseBodies)
      .toEqual(["zzqx first question", "zzqx second question"]);
    await page.waitForTimeout(2_000);
    expect(creates).toHaveLength(2);
    expect(converseBodies).toHaveLength(2);

    // The hand-off is consumed: a reload must not replay it.
    await page.reload();
    await expect(page.getByLabel("Message")).toBeVisible();
    await page.waitForTimeout(2_500);
    expect(creates).toHaveLength(2);
    expect(converseBodies).toHaveLength(2);
  });
});
