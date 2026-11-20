// HEL-1575 -- dashboard tabs, the warm cache, the changed dot and the palette's ask box, in the running app.
// jsdom has no IndexedDB, real network, native drag-and-drop, second browser context or clock, so the
// request-count claims ("a warm switch makes no panel or rows request"), reload/second-device restore, the
// 15-minute expiry and the logout wipe can only be observed here. Every test registers its own user (removed by
// the run's global teardown) and seeds its own dashboards through the API; the tests are independent.
//
// HEL-1789: the shared half of the HEL-1575 spec, moved here verbatim (only `export` added) when the spec was split into
// the `hel1575-dashboard-tabs-*.spec.ts` parts so CI's file-level sharding can place them on different legs.

import {
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  expect,
  type Page,
} from "@playwright/test";

import { CSRF_HEADER, registerAndLogin } from "./auth";

export const VIEWPORT = { width: 1440, height: 900 };
export const AUTH = { prefix: "hel1575", displayName: "HEL-1575", isolate: true } as const;
export const NAMES = ["Tabs A", "Tabs B", "Tabs C"] as const;
export type Name = (typeof NAMES)[number];

export const PANELS = /^GET \/api\/dashboards\/[^/]+\/panels$/;
export const ROWS = /^GET \/api\/outputs\/[^/]+\/rows$/;

export interface Workspace {
  dashboards: Record<Name, string>;
  pipelines: Record<Name, string>;
  sources: Record<Name, string>;
  panels: Record<Name, { tableId: string; noteId: string }>;
}

export async function post<T>(request: APIRequestContext, url: string, data: unknown): Promise<T> {
  const res = await request.post(url, { data, headers: { [CSRF_HEADER]: "1" } });
  expect(res.status(), `${url} ${await res.text()}`).toBeLessThan(300);
  return (await res.json()) as T;
}

/** One dashboard per name, each with its own source -> pipeline -> table Output (so a run on one dashboard's
 *  pipeline never marks another) bound to one table panel plus one markdown note. */
export async function seedWorkspace(
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

export function recorder(page: Page) {
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

export const tablist = (page: Page) => page.getByRole("tablist", { name: "Open dashboards" });
export const tabNamed = (page: Page, name: string) =>
  tablist(page).getByRole("tab", { name: new RegExp(`^${name}(,|$)`) });
export const tabById = (page: Page, id: string) =>
  page.locator(`[role="tab"][data-tab-id="${id}"]`);
export const dotOf = (page: Page, id: string) => tabById(page, id).locator(".dashboard-tab__dot");
export const list = (page: Page) => page.locator(".dashboard-list");

export async function tabOrder(page: Page): Promise<string[]> {
  return page.locator(".dashboard-tab__name").allTextContents();
}

export async function ctrlOpen(page: Page, name: string) {
  await list(page)
    .getByRole("button", { name, exact: true })
    .click({ modifiers: ["Control"] });
}

/** The table panel's body has rendered its rows (no skeleton). */
export async function expectTableRendered(page: Page, name: string) {
  const card = page.locator(".panel-grid-card", { hasText: `${name} table` });
  await expect(card.getByRole("cell", { name: "East", exact: true })).toBeVisible();
  await expect(card.getByRole("cell", { name: "West", exact: true })).toBeVisible();
}

/** The tab set the server holds for this user (`users.preferences.dashboardTabs`, via `/api/auth/me`). */
export async function savedTabs(page: Page): Promise<{ ids: string[]; activeId: string | null }> {
  const res = await page.request.get("/api/auth/me");
  const me = (await res.json()) as {
    preferences?: { dashboardTabs?: { tabs: { id: string }[]; activeId?: string | null } };
  };
  const saved = me.preferences?.dashboardTabs;
  return { ids: (saved?.tabs ?? []).map((t) => t.id), activeId: saved?.activeId ?? null };
}

/** Waits (the save is a 1s coalesced PATCH) until the server holds `id` as the active tab. */
export async function expectSavedActive(page: Page, id: string) {
  await expect
    .poll(async () => (await savedTabs(page)).activeId, {
      timeout: 15_000,
      message: "saved active",
    })
    .toBe(id);
}

/** Waits (the save is a 1s coalesced PATCH) until the server holds exactly `order` with `activeId` active. */
export async function expectSaved(page: Page, order: string[], activeId: string | null) {
  await expect
    .poll(() => savedTabs(page), { timeout: 15_000, message: "saved tab set" })
    .toEqual({ ids: order, activeId });
}

/** Fires the visibility trigger (the same one a user returning to the browser tab fires) and waits for the
 *  change signals to land. */
export async function refreshSignals(page: Page) {
  const done = page.waitForResponse((r) => r.url().includes("/api/dashboard-changes"));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await done;
  await page.waitForTimeout(400);
}

export async function runPipeline(request: APIRequestContext, pipelineId: string) {
  await post(request, `/api/pipelines/${pipelineId}/run`, {});
}

export async function renamePanel(page: Page, from: string, to: string) {
  await page.getByRole("button", { name: `${from} panel actions` }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const input = page.getByLabel("Panel title");
  await input.fill(to);
  // The title edit is staged locally; the leave flush (not a per-edit PATCH) persists it.
  await input.press("Enter");
  await expect(page.getByRole("heading", { name: to })).toBeVisible();
}

// HEL-1576: panels move only while layout edit mode is on (idempotent: once on, the toggle is named "Done").
export async function enterLayoutEditMode(page: Page) {
  const toggle = page.getByRole("button", { name: "Edit layout" });
  if ((await toggle.count()) > 0) await toggle.click();
  await expect(page.getByRole("button", { name: "Done" })).toBeVisible();
}

export async function dragFirstCardDown(page: Page) {
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

export async function warmEntryCount(page: Page): Promise<number | null> {
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

/**
 * The count after a sign-out. A 401 from any in-flight request makes the app's interceptor hard-navigate to
 * /login (main.tsx), and that navigation can commit after `waitForURL("/login")` has already resolved on the SPA's
 * own redirect, destroying the page's execution context mid-evaluate (CI 38987195427). The destroyed context is a
 * transient of the sign-out, not a count: report it as "not yet zero" (-1) so the poll reads again in the
 * settled document, which is the one whose state is being asserted.
 */
export async function warmEntryCountAfterSignOut(page: Page): Promise<number> {
  try {
    return (await warmEntryCount(page)) ?? 0;
  } catch (error) {
    if (error instanceof Error && error.message.includes("Execution context was destroyed"))
      return -1;
    throw error;
  }
}

export async function secondContext(browser: Browser, page: Page): Promise<BrowserContext> {
  const baseURL = new URL(page.url()).origin;
  return browser.newContext({
    baseURL,
    viewport: VIEWPORT,
    storageState: await page.context().storageState(),
  });
}

/** Opens `/dashboards` in the second device's context and waits until its tab strip is up and its change signals
 *  (set up before the navigation: the response can land before the first line after `goto` runs) have loaded. */
export async function openOtherDevice(context: BrowserContext): Promise<Page> {
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
export function trackRunBaselines(page: Page) {
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
export async function openThreeTabs(page: Page, request: APIRequestContext) {
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
export async function stubConverse(page: Page): Promise<string[]> {
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

export async function askFromPalette(page: Page, text: string) {
  // /chat has no command-bar box, so the palette is opened with its shortcut (global on every route).
  await page.keyboard.press("Control+k");
  const search = page.getByRole("dialog").getByRole("combobox", { name: "Search commands" });
  await expect(search).toBeVisible();
  await search.fill(text);
  await page.getByRole("option", { name: `Ask the assistant: "${text}"` }).click();
}
