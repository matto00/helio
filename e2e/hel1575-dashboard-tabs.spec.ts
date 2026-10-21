import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { CSRF_HEADER, currentUserId, registerAndLogin, registerUser } from "./support/auth";
import { setUserTierForTest } from "./support/historySeed";
import { loginThenIsolate } from "./support/isolateLivePage";

// HEL-1575 -- dashboard tabs, the warm cache, the changed dot and the palette's ask box, in the running app.
// jsdom has no IndexedDB, real network, native drag-and-drop, second browser context or clock, so the
// request-count claims ("a warm switch makes no panel or rows request"), reload/second-device restore, the
// 15-minute expiry and the logout wipe can only be observed here. Every test registers its own user (removed by
// the run's global teardown) and seeds its own dashboards through the API; the tests are independent.

test.describe.configure({ mode: "parallel" });

const VIEWPORT = { width: 1440, height: 900 };
const AUTH = { prefix: "hel1575", displayName: "HEL-1575", isolate: true } as const;
const NAMES = ["Tabs A", "Tabs B", "Tabs C"] as const;
type Name = (typeof NAMES)[number];

const PANELS = /^GET \/api\/dashboards\/[^/]+\/panels$/;
const ROWS = /^GET \/api\/outputs\/[^/]+\/rows$/;

interface Workspace {
  dashboards: Record<Name, string>;
  pipelines: Record<Name, string>;
  sources: Record<Name, string>;
  panels: Record<Name, { tableId: string; noteId: string }>;
}

async function post<T>(request: APIRequestContext, url: string, data: unknown): Promise<T> {
  const res = await request.post(url, { data, headers: { [CSRF_HEADER]: "1" } });
  expect(res.status(), `${url} ${await res.text()}`).toBeLessThan(300);
  return (await res.json()) as T;
}

/** One dashboard per name, each with its own source -> pipeline -> table Output (so a run on one dashboard's
 *  pipeline never marks another) bound to one table panel plus one markdown note. */
async function seedWorkspace(
  request: APIRequestContext,
  names: readonly Name[] = NAMES,
): Promise<Workspace> {
  const dashboards = {} as Record<Name, string>;
  const pipelines = {} as Record<Name, string>;
  const sources = {} as Record<Name, string>;
  const panels = {} as Record<Name, { tableId: string; noteId: string }>;
  for (const name of names) {
    const dash = await post<{ id: string }>(request, "/api/dashboards", { name });
    const source = await post<{ id: string }>(request, "/api/data-sources", {
      name: `${name} source`,
      type: "static",
      columns: [
        { name: "region", type: "string", required: true },
        { name: "revenue", type: "integer", required: true },
      ],
      rows: [
        ["East", 100],
        ["West", 150],
      ],
    });
    const pipeline = await post<{ id: string }>(request, "/api/pipelines", {
      name: `${name} pipeline`,
      roots: [{ sourceId: source.id }],
    });
    const output = await post<{ id: string }>(request, `/api/pipelines/${pipeline.id}/outputs`, {
      kind: "table",
      name: `${name} output`,
      config: {},
    });
    await post(request, `/api/pipelines/${pipeline.id}/run`, {});
    const table = await post<{ id: string }>(request, "/api/panels", {
      dashboardId: dash.id,
      title: `${name} table`,
      type: "output",
      config: { outputId: output.id },
    });
    const note = await post<{ id: string }>(request, "/api/panels", {
      dashboardId: dash.id,
      title: `${name} note`,
      type: "markdown",
      config: { content: `${name} note body` },
    });
    await post(request, `/api/dashboards/${dash.id}/auto-layout`, {
      items: [table, note].map((p) => ({ panelId: p.id, w: 6, h: 5 })),
    });
    dashboards[name] = dash.id;
    pipelines[name] = pipeline.id;
    sources[name] = source.id;
    panels[name] = { tableId: table.id, noteId: note.id };
  }
  return { dashboards, pipelines, sources, panels };
}

function recorder(page: Page) {
  const log: string[] = [];
  page.on("request", (r) => {
    const url = new URL(r.url());
    if (url.pathname.startsWith("/api/")) log.push(`${r.method()} ${url.pathname}`);
  });
  return {
    mark: () => log.length,
    since: (from: number, re: RegExp) => log.slice(from).filter((c) => re.test(c)),
    all: () => log,
  };
}

const tablist = (page: Page) => page.getByRole("tablist", { name: "Open dashboards" });
const tabNamed = (page: Page, name: string) =>
  tablist(page).getByRole("tab", { name: new RegExp(`^${name}(,|$)`) });
const tabById = (page: Page, id: string) => page.locator(`[role="tab"][data-tab-id="${id}"]`);
const dotOf = (page: Page, id: string) => tabById(page, id).locator(".dashboard-tab__dot");
const list = (page: Page) => page.locator(".dashboard-list");

async function tabOrder(page: Page): Promise<string[]> {
  return page.locator(".dashboard-tab__name").allTextContents();
}

async function ctrlOpen(page: Page, name: string) {
  await list(page)
    .getByRole("button", { name, exact: true })
    .click({ modifiers: ["Control"] });
}

/** The table panel's body has rendered its rows (no skeleton). */
async function expectTableRendered(page: Page, name: string) {
  const card = page.locator(".panel-grid-card", { hasText: `${name} table` });
  await expect(card.getByRole("cell", { name: "East", exact: true })).toBeVisible();
  await expect(card.getByRole("cell", { name: "West", exact: true })).toBeVisible();
}

/** The tab set the server holds for this user (`users.preferences.dashboardTabs`, via `/api/auth/me`). */
async function savedTabs(page: Page): Promise<{ ids: string[]; activeId: string | null }> {
  const res = await page.request.get("/api/auth/me");
  const me = (await res.json()) as {
    preferences?: { dashboardTabs?: { tabs: { id: string }[]; activeId?: string | null } };
  };
  const saved = me.preferences?.dashboardTabs;
  return { ids: (saved?.tabs ?? []).map((t) => t.id), activeId: saved?.activeId ?? null };
}

/** Waits (the save is a 1s coalesced PATCH) until the server holds `id` as the active tab. */
async function expectSavedActive(page: Page, id: string) {
  await expect
    .poll(async () => (await savedTabs(page)).activeId, {
      timeout: 15_000,
      message: "saved active",
    })
    .toBe(id);
}

/** Waits (the save is a 1s coalesced PATCH) until the server holds exactly `order` with `activeId` active. */
async function expectSaved(page: Page, order: string[], activeId: string | null) {
  await expect
    .poll(() => savedTabs(page), { timeout: 15_000, message: "saved tab set" })
    .toEqual({ ids: order, activeId });
}

/** Fires the visibility trigger (the same one a user returning to the browser tab fires) and waits for the
 *  change signals to land. */
async function refreshSignals(page: Page) {
  const done = page.waitForResponse((r) => r.url().includes("/api/dashboard-changes"));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await done;
  await page.waitForTimeout(400);
}

async function runPipeline(request: APIRequestContext, pipelineId: string) {
  await post(request, `/api/pipelines/${pipelineId}/run`, {});
}

async function renamePanel(page: Page, from: string, to: string) {
  await page.getByRole("button", { name: `${from} panel actions` }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const input = page.getByLabel("Panel title");
  await input.fill(to);
  // The title edit is staged locally; the leave flush (not a per-edit PATCH) persists it.
  await input.press("Enter");
  await expect(page.getByRole("heading", { name: to })).toBeVisible();
}

// HEL-1576: panels move only while layout edit mode is on (idempotent: once on, the toggle is named "Done").
async function enterLayoutEditMode(page: Page) {
  const toggle = page.getByRole("button", { name: "Edit layout" });
  if ((await toggle.count()) > 0) await toggle.click();
  await expect(page.getByRole("button", { name: "Done" })).toBeVisible();
}

async function dragFirstCardDown(page: Page) {
  await enterLayoutEditMode(page);
  const handle = page.locator(".panel-grid-card__handle").first();
  const bb = (await handle.boundingBox())!;
  const sx = bb.x + bb.width / 2;
  const sy = bb.y + bb.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx, sy + 120, { steps: 8 });
  await page.mouse.move(sx, sy + 260, { steps: 8 });
  await page.waitForTimeout(50);
  await page.mouse.up();
  await expect(page.getByText("Unsaved changes")).toBeVisible();
}

async function warmEntryCount(page: Page): Promise<number | null> {
  return page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    if (!dbs.some((d) => d.name === "helio-warm")) return null;
    return new Promise<number>((resolve) => {
      const open = indexedDB.open("helio-warm");
      open.onerror = () => resolve(-1);
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains("entries")) {
          db.close();
          resolve(0);
          return;
        }
        const count = db.transaction("entries").objectStore("entries").count();
        count.onsuccess = () => {
          db.close();
          resolve(count.result);
        };
      };
    });
  });
}

async function secondContext(browser: Browser, page: Page): Promise<BrowserContext> {
  const baseURL = new URL(page.url()).origin;
  return browser.newContext({
    baseURL,
    viewport: VIEWPORT,
    storageState: await page.context().storageState(),
  });
}

/** Opens `/dashboards` in the second device's context and waits until its tab strip is up and its change signals
 *  (set up before the navigation: the response can land before the first line after `goto` runs) have loaded. */
async function openOtherDevice(context: BrowserContext): Promise<Page> {
  const second = await context.newPage();
  const changes = second.waitForResponse((r) => r.url().includes("/api/dashboard-changes"));
  await second.goto("/dashboards");
  await expect(tablist(second)).toBeVisible();
  await changes;
  await second.waitForTimeout(500);
  return second;
}

/** Row windows are reused on a return only once the client knows the pipeline's latest run (the baseline a
 *  `runs/latest` read records, which a card that is unmounted first aborts). So a fixture that skims through
 *  tabs waits for that read before leaving each one; a user skimming faster than that simply refetches. */
function trackRunBaselines(page: Page) {
  const seen = new Set<string>();
  page.on("response", (r) => {
    const match = /\/api\/pipelines\/([^/]+)\/runs\/latest$/.exec(new URL(r.url()).pathname);
    if (match) seen.add(match[1]);
  });
  return async (pipelineId: string) => {
    await expect.poll(() => seen.has(pipelineId), { timeout: 15_000 }).toBe(true);
    await page.waitForTimeout(150);
  };
}

/** Seeds a workspace for a fresh user, opens the three dashboards as tabs (A active) and visits each so all
 *  three are warm, ending on A with the tab set saved. */
async function openThreeTabs(page: Page, request: APIRequestContext) {
  await page.setViewportSize(VIEWPORT);
  await registerAndLogin(page, request, AUTH);
  const ws = await seedWorkspace(request);
  const baselineKnown = trackRunBaselines(page);
  await page.goto(`/dashboards/${ws.dashboards["Tabs A"]}`);
  await expectTableRendered(page, "Tabs A");
  await baselineKnown(ws.pipelines["Tabs A"]);
  // A background tab opens right after the active one, so C first gives the order A, B, C.
  await ctrlOpen(page, "Tabs C");
  await ctrlOpen(page, "Tabs B");
  await expect(page.locator(".dashboard-tab")).toHaveCount(3);
  for (const name of ["Tabs B", "Tabs C", "Tabs A"] as const) {
    await tabNamed(page, name).click();
    await expect(tabNamed(page, name)).toHaveAttribute("aria-selected", "true");
    await expectTableRendered(page, name);
    await baselineKnown(ws.pipelines[name]);
  }
  return ws;
}

/** No real Claude call, no quota: the converse route is answered here. Conversation creation stays real.
 *  Returns the live list of message bodies the page sent. */
async function stubConverse(page: Page): Promise<string[]> {
  const converseBodies: string[] = [];
  await page.route("**/api/assistant-conversations/*/converse", async (route) => {
    const body = route.request().postDataJSON() as { message: string };
    converseBodies.push(body.message);
    // A real turn takes seconds; the chat page's own detail read for the new conversation lands first.
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const id = new URL(route.request().url()).pathname.split("/").slice(-2)[0];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id,
        title: "HEL-1575 stub",
        pinned: false,
        updatedAt: new Date().toISOString(),
        transcript: [
          { role: "user", content: [{ blockType: "text", text: body.message }] },
          { role: "assistant", content: [{ blockType: "text", text: "stubbed reply" }] },
        ],
      }),
    });
  });
  return converseBodies;
}

async function askFromPalette(page: Page, text: string) {
  // /chat has no command-bar box, so the palette is opened with its shortcut (global on every route).
  await page.keyboard.press("Control+k");
  const search = page.getByRole("dialog").getByRole("combobox", { name: "Search commands" });
  await expect(search).toBeVisible();
  await search.fill(text);
  await page.getByRole("option", { name: `Ask the assistant: "${text}"` }).click();
}

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
    await expect.poll(async () => (await warmEntryCount(page)) ?? 0).toBe(0);
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
