import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { currentUserId, registerUser } from "./support/auth";
import { evidencePath } from "./support/evidencePath";

// HEL-1783 -- a dashboard-only GRANTEE (viewer: a dashboard grant, NO pipeline grant) gets, for a SHARED dashboard DA:
//   (a) a warm tab: DA -> DB -> DA within the TTL with nothing changed sends no DA panel-list or rows request;
//   (b) the open-tab "changed" dot when the owner's run commits new data while the viewer is on DB, and on return the new
//       value read through the per-panel rows route;
//   (c) `GET /api/dashboard-changes` returning a non-null data time for DA (the dot's source);
//   (d) a warm RELOAD: the stored copy restores DA with no panel-list or rows request, for a table whose Output has a
//       persisted default `columnSort` (the card's first mount must not send a stripped rows request, skeptic-design-6).
// The invariant is on the REQUESTS (dev's superuser connection hides the RLS refusal): while the viewer views, no request goes
// to /api/outputs or /api/pipelines, no /api response is an error and nothing is logged as a console error.
// The data-change step is driven by the tab strip's own visibility trigger (a `visibilitychange` to visible at least
// `SIGNALS_VISIBLE_MIN_GAP_MS` after the previous refresh, tabsBrowserTriggers.ts), never by waiting out the 2 minute cadence.

const CSRF = { "X-Helio-Requested-With": "1" };
const DEV_PORT = process.env.DEV_PORT ?? "5173";
const BASE_URL = `http://localhost:${DEV_PORT}`;
const RUN = Date.now();
const SOURCE_NAME = `HEL1783 Sales CSV ${RUN}`;
const DA_NAME = `HEL1783 shared board ${RUN}`;
const DB_NAME = `HEL1783 own board ${RUN}`;
const TABLE_TITLE = `HEL1783 table panel ${RUN}`;

const PANEL_LIST = /^GET \/api\/dashboards\/([^/]+)\/panels$/;
const PANEL_ROWS = /^GET \/api\/dashboards\/([^/]+)\/panels\/[^/]+\/rows$/;

interface Actor {
  context: BrowserContext;
  page: Page;
  id: string;
}

async function newActor(browser: Browser, label: string): Promise<Actor> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await registerUser(context.request, { prefix: "hel1783", label, displayName: "HEL1783" });
  const id = await currentUserId(context.request);
  const page = await context.newPage();
  return { context, page, id };
}

async function postJson<T>(
  request: APIRequestContext,
  url: string,
  data: unknown,
  status: number | number[],
): Promise<T> {
  const res = await request.post(url, { data, headers: CSRF });
  const ok = Array.isArray(status) ? status : [status];
  const text = await res.text();
  expect(ok, `${url}: ${res.status()} ${text}`).toContain(res.status());
  return (text ? JSON.parse(text) : {}) as T;
}

function watchNetwork(page: Page) {
  const outputRoutes: string[] = [];
  const badResponses: string[] = [];
  const consoleErrors: string[] = [];
  const calls: string[] = [];
  const onRequest = (request: { url(): string; method(): string }) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith("/api/")) calls.push(`${request.method()} ${pathname}`);
    if (/^\/api\/(outputs|pipelines)(\/|$)/.test(pathname)) {
      outputRoutes.push(`${request.method()} ${pathname}`);
    }
  };
  const onResponse = (response: {
    url(): string;
    status(): number;
    request(): { method(): string };
  }) => {
    const { pathname } = new URL(response.url());
    if (pathname.startsWith("/api/") && response.status() >= 400) {
      badResponses.push(`${response.status()} ${response.request().method()} ${pathname}`);
    }
  };
  const onConsole = (message: { type(): string; text(): string }) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  };
  page.on("request", onRequest);
  page.on("response", onResponse);
  page.on("console", onConsole);
  return {
    mark: () => calls.length,
    since: (from: number, re: RegExp, dashboardId: string) =>
      calls.slice(from).filter((c) => {
        const m = re.exec(c);
        return m !== null && m[1] === dashboardId;
      }),
    stop() {
      page.off("request", onRequest);
      page.off("response", onResponse);
      page.off("console", onConsole);
      return { outputRoutes, badResponses, consoleErrors };
    },
  };
}

function expectInvariant(seen: ReturnType<ReturnType<typeof watchNetwork>["stop"]>): void {
  expect(seen.outputRoutes, "requests to /api/outputs or /api/pipelines").toEqual([]);
  expect(seen.badResponses, "/api responses that are errors").toEqual([]);
  expect(seen.consoleErrors, "console errors").toEqual([]);
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

let owner: Actor;
let viewer: Actor;
let sharedId: string;
let ownId: string;
let sourceId: string;
let pipelineId: string;
let outputId: string;

const tablist = (page: Page) => page.getByRole("tablist", { name: "Open dashboards" });
const tabById = (page: Page, id: string) => page.locator(`[role="tab"][data-tab-id="${id}"]`);
const dotOf = (page: Page, id: string) => tabById(page, id).locator(".dashboard-tab__dot");
const cell = (page: Page, text: string) => page.getByRole("cell", { name: text, exact: true });

// tabsBrowserTriggers.ts: a visibility refresh is skipped when the previous refresh was under this long ago.
const SIGNALS_VISIBLE_MIN_GAP_MS = 30_000;
let lastSignalsRefreshAt = 0;

/** Fires the visibility trigger (the one a user returning to the browser tab fires) and waits for the change signals. It first
 *  waits out `SIGNALS_VISIBLE_MIN_GAP_MS` since the previous refresh this spec saw (the page's own 2 minute cadence and the
 *  initial load also refresh, so the wait is an upper bound), instead of waiting for the cadence. */
async function refreshSignals(page: Page) {
  const wait = lastSignalsRefreshAt + SIGNALS_VISIBLE_MIN_GAP_MS + 1_000 - Date.now();
  if (wait > 0) await page.waitForTimeout(wait);
  lastSignalsRefreshAt = Date.now();
  const done = page.waitForResponse((r) => r.url().includes("/api/dashboard-changes"));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await done;
  await page.waitForTimeout(400);
}

test.describe("HEL-1783 a grantee's shared dashboard tab is warm and shows data-change dots", () => {
  test.setTimeout(240_000);

  test.beforeAll(async ({ browser }) => {
    owner = await newActor(browser, "owner");
    viewer = await newActor(browser, "viewer");
    const api = owner.context.request;
    const source = await postJson<{ id: string }>(
      api,
      "/api/data-sources",
      {
        name: SOURCE_NAME,
        type: "static",
        columns: [
          { name: "region", type: "string", required: true },
          { name: "revenue", type: "integer", required: true },
        ],
        rows: [
          ["East", 100],
          ["West", 150],
        ],
      },
      201,
    );
    sourceId = source.id;
    const pipeline = await postJson<{ id: string }>(
      api,
      "/api/pipelines",
      { name: `HEL1783 pipeline ${RUN}`, roots: [{ sourceId }] },
      201,
    );
    pipelineId = pipeline.id;
    // A persisted DEFAULT sort: the stored-copy restore must not send a stripped (unsorted) mount request for it.
    const out = await postJson<{ id: string }>(
      api,
      `/api/pipelines/${pipelineId}/outputs`,
      {
        kind: "table",
        name: "HEL1783 table",
        config: { columnSort: { key: "revenue", direction: "desc" } },
      },
      201,
    );
    outputId = out.id;
    const run = await api.post(`/api/pipelines/${pipelineId}/run`, { data: {}, headers: CSRF });
    expect(run.status(), await run.text()).toBeLessThan(300);
    await expect
      .poll(
        async () => {
          const rows = await api.get(`/api/outputs/${outputId}/rows`);
          return rows.status() === 200 ? ((await rows.json()) as { total: number }).total : -1;
        },
        { timeout: 30_000 },
      )
      .toBe(2);
    const shared = await postJson<{ id: string }>(api, "/api/dashboards", { name: DA_NAME }, 201);
    sharedId = shared.id;
    await postJson(
      api,
      "/api/panels",
      { dashboardId: sharedId, title: TABLE_TITLE, type: "output", config: { outputId } },
      201,
    );
    await postJson(
      api,
      `/api/dashboards/${sharedId}/permissions`,
      { granteeId: viewer.id, role: "viewer" },
      201,
    );
    const own = await postJson<{ id: string }>(
      viewer.context.request,
      "/api/dashboards",
      { name: DB_NAME },
      201,
    );
    ownId = own.id;
  });

  test.afterAll(async () => {
    for (const a of [owner, viewer]) await a?.context.close();
  });

  test("warm switch and reload make no panel requests; new data shows the dot and refreshes through the per-panel route", async () => {
    const page = viewer.page;
    const net = watchNetwork(page);
    await page.goto(`/dashboards/${sharedId}`);
    await expect(page.getByText("Dashboard not found")).toHaveCount(0);
    await expect(cell(page, "East").first()).toBeVisible();
    // Open the second tab (ctrl-click in the list), then switch to it so DA is a LEFT, warm tab.
    await page
      .locator(".dashboard-list")
      .getByRole("button", { name: DB_NAME, exact: true })
      .click({ modifiers: ["Control"] });
    await expect(tabById(page, ownId)).toBeVisible();
    await tabById(page, ownId).click();
    await expect(tabById(page, ownId)).toHaveAttribute("aria-selected", "true");

    // (a) DA -> DB -> DA within the TTL, nothing changed: no DA panel-list or rows request.
    await refreshSignals(page);
    await expect(dotOf(page, sharedId)).toHaveCount(0);
    let from = net.mark();
    await tabById(page, sharedId).click();
    await expect(cell(page, "East").first()).toBeVisible();
    await page.waitForTimeout(1_000);
    expect(net.since(from, PANEL_LIST, sharedId), "(a) DA panel-list requests").toEqual([]);
    expect(net.since(from, PANEL_ROWS, sharedId), "(a) DA rows requests").toEqual([]);

    // (b) on DB, the owner changes the data and runs: the signals show DA's tab with the dot.
    await tabById(page, ownId).click();
    await expect(tabById(page, ownId)).toHaveAttribute("aria-selected", "true");
    await postJson(
      owner.context.request,
      `/api/data-sources/${sourceId}/rows`,
      { rows: [["North", 200]] },
      [200, 201],
    );
    const run = await owner.context.request.post(`/api/pipelines/${pipelineId}/run`, {
      data: {},
      headers: CSRF,
    });
    expect(run.status(), await run.text()).toBeLessThan(300);
    await expect
      .poll(
        async () => {
          const rows = await owner.context.request.get(`/api/outputs/${outputId}/rows`);
          return rows.status() === 200 ? ((await rows.json()) as { total: number }).total : -1;
        },
        { timeout: 30_000 },
      )
      .toBe(3);
    await refreshSignals(page);
    await expect(dotOf(page, sharedId)).toHaveCount(1);
    await expect(tabById(page, sharedId)).toHaveAccessibleName(
      `${DA_NAME}, changed since you last viewed`,
    );

    // (c) the route's own answer for the shared dashboard carries the data time (and only ids the panel list returns).
    const changes = await page.request.get(`/api/dashboard-changes?ids=${sharedId}`);
    expect(changes.status()).toBe(200);
    const body = (await changes.json()) as {
      items: {
        dashboardId: string;
        dataUpdatedAt: string | null;
        outputs: { outputId: string }[];
      }[];
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].dataUpdatedAt).not.toBeNull();
    expect(body.items[0].outputs.map((o) => o.outputId)).toEqual([outputId]);

    // The return shows the new value, read through the per-panel rows route, and clears the dot.
    from = net.mark();
    await tabById(page, sharedId).click();
    await expect(cell(page, "North").first()).toBeVisible({ timeout: 30_000 });
    await expect(dotOf(page, sharedId)).toHaveCount(0);
    expect(
      net.since(from, PANEL_ROWS, sharedId).length,
      "(b) rows re-read through the per-panel route",
    ).toBeGreaterThanOrEqual(1);
    await page.screenshot({ path: evidencePath("HEL-1783", "viewer-shared-tab-refreshed.png") });

    // (d) leave DA (its copy is stored), reload on DB, and return to DA within the TTL: warm, no DA requests.
    await tabById(page, ownId).click();
    await expect(tabById(page, ownId)).toHaveAttribute("aria-selected", "true");
    await refreshSignals(page);
    await expect.poll(() => warmEntryCount(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
    await page.waitForTimeout(1_500); // the debounced write of DA's copy lands
    // A full navigation to DB (the URL still names DA, which a plain reload would deep-link back to): the page reloads.
    await page.goto(`/dashboards/${ownId}`);
    await expect(tablist(page)).toBeVisible();
    await expect(tabById(page, ownId)).toHaveAttribute("aria-selected", "true");
    from = net.mark();
    await tabById(page, sharedId).click();
    await expect(cell(page, "North").first()).toBeVisible();
    await page.waitForTimeout(2_000);
    expect(net.since(from, PANEL_LIST, sharedId), "(d) DA panel-list requests").toEqual([]);
    expect(net.since(from, PANEL_ROWS, sharedId), "(d) DA rows requests").toEqual([]);
    await page.screenshot({ path: evidencePath("HEL-1783", "viewer-shared-tab-reload-warm.png") });

    expectInvariant(net.stop());
  });
});
