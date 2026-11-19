import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { currentUserId, registerUser, type Credentials } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import { setUserTierForTest } from "./support/historySeed";
import { seedInsightRender } from "./support/insightSeed";

// HEL-1780 (child 2 of HEL-1773) -- a dashboard GRANTEE (viewer, editor, and a user who also holds a pipeline grant)
// gets the panel features that the per-panel routes can serve, on a dashboard they do not own:
//   * viewer controls (dropdown options via distinct-values) and the rows they filter;
//   * table sort: on the panel's own control column it goes to the server (the request carries `sort`), on any other
//     column it orders the LOADED rows in the browser (no request names the column) with the loaded-scope disclosure;
//   * cross-filter on a dimension the table does not control: client-fallback, no request carries the dimension;
//   * the metric's compare sparkline (history), the insight body with its citation chip and no Refresh button,
//     provenance, and the detail modal's controls and provenance.
// INVARIANT (every test): no request to /api/outputs or /api/pipelines, no /api 4xx/5xx, no console error. The grants
// are dashboard-only (the dual user also holds a pipeline grant, on a pipeline of its own that backs none of the shared
// panels' attribution), and dev's superuser connection hides what RLS would refuse -- so the proof here is the REQUESTS;
// the RLS proof is the helio_app run recorded with the backend spec.
// Insight renders are rows inserted directly (support/insightSeed.ts): no model is ever called (ANTHROPIC_API_KEY empty).

const CSRF = { "X-Helio-Requested-With": "1" };
const DEV_PORT = process.env.DEV_PORT ?? "5173";
const BASE_URL = `http://localhost:${DEV_PORT}`;
const RUN = Date.now();

const NAMES = {
  shared: `HEL1780 shared board ${RUN}`,
  table: `HEL1780 table ${RUN}`,
  chart: `HEL1780 chart ${RUN}`,
  metric: `HEL1780 metric ${RUN}`,
  insight: `HEL1780 insight ${RUN}`,
  viewerOwn: `HEL1780 viewer own ${RUN}`,
  dualOwn: `HEL1780 dual own ${RUN}`,
};
const REGIONS = ["East", "West", "North"];
const TOTAL_ROWS = 250;
const LOADED_ROWS = 200;

interface Actor {
  context: BrowserContext;
  page: Page;
  id: string;
  credentials: Credentials;
}

async function newActor(browser: Browser, label: string): Promise<Actor> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  const credentials = await registerUser(context.request, {
    prefix: "hel1780",
    label,
    displayName: "HEL1780",
  });
  const id = await currentUserId(context.request);
  return { context, page: await context.newPage(), id, credentials };
}

async function postJson<T>(
  request: APIRequestContext,
  url: string,
  data: unknown,
  status: number,
): Promise<T> {
  const res = await request.post(url, { data, headers: CSRF });
  expect(res.status(), `${url}: ${await res.text()}`).toBe(status);
  return (await res.json()) as T;
}

/** Everything a non-owner's window must NOT contain, plus the per-panel rows requests (to assert what they carry). */
function watchNetwork(page: Page) {
  const outputRoutes: string[] = [];
  const badResponses: string[] = [];
  const consoleErrors: string[] = [];
  const rowsRequests: URL[] = [];
  const onRequest = (request: { url(): string; method(): string }) => {
    const url = new URL(request.url());
    if (/^\/api\/(outputs|pipelines)(\/|$)/.test(url.pathname)) {
      outputRoutes.push(`${request.method()} ${url.pathname}`);
    }
    if (/^\/api\/dashboards\/[^/]+\/panels\/[^/]+\/rows$/.test(url.pathname))
      rowsRequests.push(url);
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
    rowsRequests,
    stop() {
      page.off("request", onRequest);
      page.off("response", onResponse);
      page.off("console", onConsole);
      return { outputRoutes, badResponses, consoleErrors, rowsRequests };
    },
  };
}

function expectInvariant(seen: ReturnType<ReturnType<typeof watchNetwork>["stop"]>): void {
  expect(seen.outputRoutes, "requests to /api/outputs or /api/pipelines").toEqual([]);
  expect(seen.badResponses, "/api responses that are errors").toEqual([]);
  expect(seen.consoleErrors, "console errors").toEqual([]);
}

let owner: Actor;
let viewer: Actor;
let editor: Actor;
let dual: Actor;
let sharedId: string;
let tablePanelId: string;
let ownerId: string;

test.describe("HEL-1780 grantees get panel features through per-panel routes", () => {
  test.beforeAll(async ({ browser }) => {
    owner = await newActor(browser, "owner");
    viewer = await newActor(browser, "viewer");
    editor = await newActor(browser, "editor");
    dual = await newActor(browser, "dual");
    ownerId = owner.id;
    // An insight Output needs a beta/owner pipeline owner (the public API cannot change a tier).
    setUserTierForTest(owner.id, "beta");
    const api = owner.context.request;

    const rows = (amountBase: number) =>
      Array.from({ length: TOTAL_ROWS }, (_, i) => [
        REGIONS[i % 3],
        `team-${i % 2 === 0 ? "a" : "b"}`,
        amountBase + i,
      ]);
    const source = await postJson<{ id: string }>(
      api,
      "/api/data-sources",
      {
        name: `HEL1780 source ${RUN}`,
        type: "static",
        columns: [
          { name: "region", type: "string", required: true },
          { name: "team", type: "string", required: true },
          { name: "amount", type: "integer", required: true },
        ],
        rows: rows(1000),
      },
      201,
    );
    const pipeline = await postJson<{ id: string }>(
      api,
      "/api/pipelines",
      { name: `HEL1780 pipeline ${RUN}`, roots: [{ sourceId: source.id }] },
      201,
    );
    const mk = (body: unknown) =>
      postJson<{ id: string }>(api, `/api/pipelines/${pipeline.id}/outputs`, body, 201);
    const table = await mk({
      kind: "table",
      name: "HEL1780 table out",
      config: { fieldMapping: {}, columnOrder: ["region", "team", "amount"] },
    });
    const chart = await mk({
      kind: "chart",
      name: "HEL1780 chart out",
      config: { chartType: "pie", fieldMapping: { xAxis: "region", yAxis: "amount" } },
    });
    const metric = await mk({
      kind: "metric",
      name: "HEL1780 metric out",
      config: {
        fieldMapping: {},
        aggregation: { value: "amount", agg: "sum" },
        format: "integer",
        compare: "previous_run",
      },
    });
    const insight = await mk({ kind: "insight", name: "HEL1780 insight out", config: {} });

    const run = async () => {
      const res = await api.post(`/api/pipelines/${pipeline.id}/run`, { data: {}, headers: CSRF });
      expect(res.status(), await res.text()).toBe(200);
    };
    await run();
    const put = await api.put(`/api/data-sources/${source.id}/rows`, {
      data: { rows: rows(2000) },
      headers: CSRF,
    });
    expect(put.status(), await put.text()).toBe(200);
    await run(); // two runs: the metric has a previous run to compare with and a sparkline
    await expect
      .poll(
        async () => {
          const res = await api.get(`/api/outputs/${table.id}/rows`);
          return res.status() === 200 ? ((await res.json()) as { total: number }).total : -1;
        },
        { timeout: 30_000 },
      )
      .toBe(TOTAL_ROWS);

    const dash = await postJson<{ id: string }>(
      api,
      "/api/dashboards",
      { name: NAMES.shared },
      201,
    );
    sharedId = dash.id;
    const panel = (title: string, outputId: string, controls?: unknown[]) =>
      postJson<{ id: string }>(
        api,
        "/api/panels",
        {
          dashboardId: sharedId,
          title,
          type: "output",
          config: controls ? { outputId, controls } : { outputId },
        },
        201,
      );
    // The ONE control is on `team`: `amount` and `region` are NOT control columns (client-side sort/filter/cross-filter).
    const tablePanel = await panel(NAMES.table, table.id, [
      { id: "team-ctl", kind: "dropdown", column: "team", label: "Team" },
    ]);
    tablePanelId = tablePanel.id;
    const chartPanel = await panel(NAMES.chart, chart.id);
    const metricPanel = await panel(NAMES.metric, metric.id);
    const insightPanel = await panel(NAMES.insight, insight.id);
    await postJson(
      api,
      `/api/dashboards/${sharedId}/auto-layout`,
      {
        items: [
          { panelId: tablePanel.id, w: 6, h: 6 },
          { panelId: chartPanel.id, w: 5, h: 5 },
          { panelId: metricPanel.id, w: 4, h: 3 },
          { panelId: insightPanel.id, w: 6, h: 4 },
        ],
      },
      200,
    );
    seedInsightRender({
      insightOutputId: insight.id,
      pipelineId: pipeline.id,
      userId: owner.id,
      markdown: "Orders hold three regions [c1].",
      citations: [{ id: "c1", outputId: table.id, field: "region", number: 3 }],
    });

    // Dashboard-only grants through the real route, with an explicit granteeId.
    for (const [who, role] of [
      [viewer, "viewer"],
      [editor, "editor"],
      [dual, "viewer"],
    ] as const) {
      await postJson(
        api,
        `/api/dashboards/${sharedId}/permissions`,
        { granteeId: who.id, role },
        201,
      );
    }
    // The dual user ALSO holds a pipeline grant (S2: the dashboard role decides on a non-owned dashboard).
    await postJson(
      api,
      `/api/pipelines/${pipeline.id}/permissions`,
      { granteeId: dual.id, role: "editor" },
      201,
    );

    // The viewer and the dual user each own one dashboard binding an Output of their OWN (different from the shared ones),
    // so a switch shared -> owned -> shared can attribute every request unambiguously.
    for (const [who, name] of [
      [viewer, NAMES.viewerOwn],
      [dual, NAMES.dualOwn],
    ] as const) {
      const wapi = who.context.request;
      const wsource = await postJson<{ id: string }>(
        wapi,
        "/api/data-sources",
        {
          name: `HEL1780 own source ${who.id}`,
          type: "static",
          columns: [{ name: "city", type: "string", required: true }],
          rows: [["Oslo"]],
        },
        201,
      );
      const wpipe = await postJson<{ id: string }>(
        wapi,
        "/api/pipelines",
        { name: `HEL1780 own pipeline ${who.id}`, roots: [{ sourceId: wsource.id }] },
        201,
      );
      const wout = await postJson<{ id: string }>(
        wapi,
        `/api/pipelines/${wpipe.id}/outputs`,
        { kind: "table", name: "HEL1780 own table", config: {} },
        201,
      );
      const wrun = await wapi.post(`/api/pipelines/${wpipe.id}/run`, { data: {}, headers: CSRF });
      expect(wrun.status(), await wrun.text()).toBe(200);
      const wdash = await postJson<{ id: string }>(wapi, "/api/dashboards", { name }, 201);
      await postJson(
        wapi,
        "/api/panels",
        {
          dashboardId: wdash.id,
          title: `${name} panel`,
          type: "output",
          config: { outputId: wout.id },
        },
        201,
      );
    }
  });

  test.afterAll(async () => {
    for (const a of [owner, viewer, editor, dual]) await a?.context.close();
  });

  const card = (page: Page, title: string): Locator =>
    page
      .locator("article.panel-grid-card")
      .filter({ has: page.getByRole("heading", { name: title }) });
  const cell = (scope: Page | Locator, text: string) =>
    scope.getByRole("cell", { name: text, exact: true });

  async function openShared(page: Page): Promise<void> {
    await page.goto(`/dashboards/${sharedId}`);
    await expect(page.getByText("Dashboard not found")).toHaveCount(0);
    await expect(card(page, NAMES.table)).toBeVisible();
    await expect(cell(card(page, NAMES.table), "East").first()).toBeVisible();
  }

  /** The whole feature pass on the shared dashboard, as any grantee. `phone` skips the pointer-only canvas click. */
  async function featurePass(actor: Actor, opts: { phone?: boolean } = {}): Promise<void> {
    const { page } = actor;
    test.setTimeout(150_000);
    const watch = watchNetwork(page);
    const distinct = page
      .waitForResponse(
        (r) => /\/panels\/[^/]+\/distinct-values/.test(r.url()) && r.status() === 200,
        { timeout: 10_000 },
      )
      .catch(() => null);
    await openShared(page);
    const table = card(page, NAMES.table);

    // 1. Controls: the dropdown's options come from the per-panel distinct-values route; choosing one filters on the server.
    const team = table.getByRole("combobox", { name: "Team" });
    await expect(team).toBeVisible();
    expect(await distinct, "the per-panel distinct-values route answered 200").not.toBeNull();
    await team.click();
    await expect(page.getByRole("option", { name: "team-a" })).toBeVisible();
    await expect(page.getByRole("option", { name: "team-b" })).toBeVisible();
    await page.getByRole("option", { name: "team-b" }).click();
    await expect(table.getByRole("cell", { name: "team-a", exact: true })).toHaveCount(0);
    await expect(cell(table, "team-b").first()).toBeVisible();
    expect(
      watch.rowsRequests.some((u) => (u.searchParams.get("filter") ?? "").includes("team-b")),
      "the control selection went to the per-panel rows route",
    ).toBe(true);
    await team.click();
    await page.getByRole("option", { name: "All" }).click();
    await expect(cell(table, "team-a").first()).toBeVisible();

    // 2. Sort on a NON-control column: the loaded rows are ordered in the browser, no request names `amount`, and the
    //    disclosure says it covers only the loaded rows.
    const mark = watch.rowsRequests.length;
    await table.getByRole("button", { name: "amount", exact: true }).click();
    await expect(
      table.getByText(`Sorted within the ${LOADED_ROWS} loaded rows of ${TOTAL_ROWS}.`),
    ).toBeVisible();
    await page.waitForTimeout(600); // past the sort debounce: a (wrong) dispatch would have gone out by now
    for (const u of watch.rowsRequests.slice(mark)) {
      expect(
        `${u.searchParams.get("sort") ?? ""}${u.searchParams.get("filter") ?? ""}`,
      ).not.toContain("amount");
    }
    expect(watch.rowsRequests.length, "a client-only sort sends no request").toBe(mark);

    // 3. Sort (from the client-sorted window: the server part changes, so this one dispatches) on the CONTROL column: the server orders it (the request carries `sort=team:`).
    const before = watch.rowsRequests.length;
    await table.getByRole("button", { name: "team", exact: true }).click();
    await expect
      .poll(() =>
        watch.rowsRequests
          .slice(before)
          .some((u) => (u.searchParams.get("sort") ?? "").startsWith("team:")),
      )
      .toBe(true);

    // 3b. R4 client-side filtering over the loaded rows: a quick search (the route refuses `quick` with 400) and a filter on a
    //     non-control column send NO request, and the table says the result covers only the loaded rows.
    const filterMark = watch.rowsRequests.length;
    const quietFor = async () => {
      await page.waitForTimeout(600); // past the refetch debounce: a (wrong) dispatch would have gone out by now
      expect(watch.rowsRequests.length, "a client-side filter sends no request").toBe(filterMark);
    };
    await table.getByRole("button", { name: "Filters" }).click();
    const quick = table.getByRole("textbox", { name: "Quick filter across all columns" });
    await quick.fill("East");
    await expect(
      table.getByText(`Filtered within the ${LOADED_ROWS} loaded rows of ${TOTAL_ROWS}.`),
    ).toBeVisible();
    await expect(table.getByRole("cell", { name: "West", exact: true })).toHaveCount(0);
    await expect(cell(table, "East").first()).toBeVisible();
    await quietFor();
    await quick.fill("zzz-no-match");
    await expect(
      table.getByText(
        `No loaded rows match your filter. Only ${LOADED_ROWS} of ${TOTAL_ROWS} rows were searched.`,
      ),
    ).toBeVisible();
    await quietFor();
    await quick.fill("");
    const amountFilter = table.getByRole("textbox", { name: "Filter column amount" });
    await amountFilter.fill("2001");
    await expect(
      table.getByText(`Filtered within the ${LOADED_ROWS} loaded rows of ${TOTAL_ROWS}.`),
    ).toBeVisible();
    await quietFor();
    await amountFilter.fill("");
    await expect(table.getByText(/loaded rows of/)).toHaveCount(0);
    await table.getByRole("button", { name: "Filters" }).click();

    // 4. Compare sparkline (per-panel history), insight body (stored render, chip, no Refresh), non-insight Refresh.
    const metric = card(page, NAMES.metric);
    await expect(metric.getByRole("img", { name: /Trend over \d+ data points/ })).toBeVisible();
    const insight = card(page, NAMES.insight);
    await expect(insight.getByText(/Orders hold three regions/)).toBeVisible();
    await expect(insight.getByRole("button", { name: /^Source: / })).toHaveCount(1);
    await expect(insight.getByText("Not available on shared dashboards yet")).toHaveCount(0);
    await expect(insight.getByRole("button", { name: `Refresh ${NAMES.insight}` })).toHaveCount(0);
    await expect(metric.getByRole("button", { name: `Refresh ${NAMES.metric}` })).toBeVisible();
    await expect(table.getByRole("button", { name: `Refresh ${NAMES.table}` })).toBeVisible();

    // 5. Provenance (per-panel route), on a card and on the insight's citation chip.
    await expect(table.getByRole("button", { name: "Data provenance" })).toBeVisible();
    await table.getByRole("button", { name: "Data provenance" }).click();
    await expect(page.getByRole("dialog", { name: /Data provenance/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: /Data provenance/ })).toHaveCount(0);

    // 6. Cross-filter from the chart on `region`, which the table does NOT control: the table narrows its LOADED rows
    //    in the browser. No rows request carries `region`.
    if (!opts.phone) {
      const chart = card(page, NAMES.chart);
      const canvas = chart.locator(".chart-panel__canvas canvas").first();
      await expect(canvas).toBeVisible();
      await canvas.scrollIntoViewIfNeeded();
      await page.waitForTimeout(1500); // the pie's entrance animation
      const box = await canvas.boundingBox();
      if (!box) throw new Error("chart canvas has no bounding box");
      const crossMark = watch.rowsRequests.length;
      await page.mouse.click(
        box.x + box.width / 2,
        box.y + box.height / 2 - Math.min(box.width, box.height) * 0.2,
      );
      const inspect = page.getByRole("dialog", { name: `Inspect ${NAMES.chart}` });
      await expect(inspect).toBeVisible();
      const filterButton = inspect.getByRole("button", { name: /^Filter dashboard by region = / });
      const label = (await filterButton.textContent()) ?? "";
      const matched = REGIONS.find((r) => label.includes(r))!;
      await filterButton.click();
      await expect(inspect).toBeHidden();
      for (const other of REGIONS.filter((r) => r !== matched)) {
        await expect(table.getByRole("cell", { name: other, exact: true })).toHaveCount(0);
      }
      await expect(cell(table, matched).first()).toBeVisible();
      for (const u of watch.rowsRequests.slice(crossMark)) {
        expect(
          `${u.searchParams.get("sort") ?? ""}${u.searchParams.get("filter") ?? ""}`,
        ).not.toContain("region");
      }
      await page
        .getByRole("status")
        .filter({ hasText: "Filtered by region" })
        .getByRole("button", { name: "Clear cross-filter" })
        .click();
    }

    // 7. The detail modal (view mode): the control bar and provenance, from per-panel routes.
    await table.click({ position: { x: 20, y: 60 } });
    const dialog = page.getByRole("dialog").last();
    await expect(dialog.getByRole("group", { name: "Panel controls" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Data provenance" })).toBeVisible();
    await page.keyboard.press("Escape");

    expectInvariant(watch.stop());
  }

  test("viewer (dashboard-only): every feature through per-panel routes", async () => {
    await featurePass(viewer);
    await viewer.page.screenshot({ path: evidencePath("HEL-1780", "viewer-shared.png") });
  });

  test("viewer: the same dashboard on a phone", async () => {
    const context = await viewer.context.browser()!.newContext({
      baseURL: BASE_URL,
      viewport: { width: 390, height: 844 },
      storageState: await viewer.context.storageState(),
    });
    const page = await context.newPage();
    try {
      const watch = watchNetwork(page);
      await page.goto(`/dashboards/${sharedId}`);
      await expect(page.getByText(NAMES.table)).toBeVisible();
      await expect(cell(page, "East").first()).toBeVisible();
      await expect(page.getByRole("combobox", { name: "Team" })).toBeVisible();
      await expect(page.getByText(/Orders hold three regions/)).toBeVisible();
      await expect(page.getByRole("button", { name: `Refresh ${NAMES.insight}` })).toHaveCount(0);
      await expect(page.getByRole("img", { name: /Trend over \d+ data points/ })).toBeVisible();
      await expect(page.getByRole("button", { name: "Data provenance" }).first()).toBeVisible();
      await page.screenshot({ path: evidencePath("HEL-1780", "viewer-phone.png") });
      expectInvariant(watch.stop());
    } finally {
      await context.close();
    }
  });

  test("editor (dashboard-only): every feature, and the binding stays read-only", async () => {
    await featurePass(editor);
    const { page } = editor;
    const watch = watchNetwork(page);
    await page.getByRole("button", { name: `${NAMES.table} panel actions` }).click();
    await page.getByRole("menuitem", { name: "Customize" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    if (await dialog.getByRole("button", { name: "Edit panel" }).isVisible()) {
      await dialog.getByRole("button", { name: "Edit panel" }).click();
    }
    await expect(dialog.getByText("Bound to an Output")).toBeVisible();
    await page.keyboard.press("Escape");
    expectInvariant(watch.stop());
    await page.screenshot({ path: evidencePath("HEL-1780", "editor-shared.png") });
  });

  test("dual-grant user (pipeline grant AND dashboard grant): per-panel routes on the shared dashboard", async () => {
    await featurePass(dual);
  });

  test("switch shared -> own -> shared: no request goes out under the wrong role", async () => {
    for (const [actor, ownName] of [
      [viewer, NAMES.viewerOwn],
      [dual, NAMES.dualOwn],
    ] as const) {
      const { page } = actor;
      await openShared(page);
      const watch = watchNetwork(page);
      await page.getByRole("button", { name: ownName, exact: true }).click();
      await expect(card(page, `${ownName} panel`)).toBeVisible();
      await expect(cell(card(page, `${ownName} panel`), "Oslo")).toBeVisible();
      await page.getByRole("button", { name: `${NAMES.shared} (Shared)` }).click();
      await expect(card(page, NAMES.table)).toBeVisible();
      await expect(cell(card(page, NAMES.table), "East").first()).toBeVisible();
      // The own dashboard's Output route IS legitimate for its owner; only the SHARED panels must never use one.
      const seen = watch.stop();
      expect(seen.badResponses, "/api responses that are errors").toEqual([]);
      expect(seen.consoleErrors, "console errors").toEqual([]);
      expect(
        seen.outputRoutes.filter((r) => r.includes(ownerId)),
        "owner id in an output route",
      ).toEqual([]);
      expect(await seedFreeOfSharedIds(actor, seen.outputRoutes)).toEqual([]);
    }
  });
});

/** The shared Outputs'/pipeline's ids as seen by the owner; any Output/pipeline route naming one is a misrouted request. */
async function seedFreeOfSharedIds(_actor: Actor, routes: string[]): Promise<string[]> {
  const ids = await sharedIds();
  return routes.filter((r) => ids.some((id) => r.includes(id)));
}

let cachedIds: string[] | null = null;
async function sharedIds(): Promise<string[]> {
  if (cachedIds) return cachedIds;
  const res = await owner.context.request.get(`/api/dashboards/${sharedId}/panels`);
  const panels = ((await res.json()) as { items: { config: { outputId?: string } }[] }).items;
  const outputIds = panels.map((p) => p.config.outputId).filter((x): x is string => !!x);
  const pipelines = new Set<string>();
  for (const id of outputIds) {
    const o = await owner.context.request.get(`/api/outputs/${id}`);
    pipelines.add(((await o.json()) as { pipelineId: string }).pipelineId);
  }
  cachedIds = [...outputIds, ...pipelines, tablePanelId].filter(Boolean);
  return cachedIds;
}
