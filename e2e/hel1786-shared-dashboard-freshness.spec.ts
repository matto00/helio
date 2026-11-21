import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { currentUserId, registerUser, type Credentials } from "./support/auth";
import { evidencePath } from "./support/evidencePath";

// HEL-1786 -- a dashboard-only GRANTEE (viewer, then editor: dashboard grants, NO pipeline grant) gets, through
// `GET /api/dashboards/:id/panel-status` alone:
//   1. the freshness line (the meta row's refresh fact and source names; the phone "refreshed" caption),
//   2. the run-finish refresh (a panel re-reads its rows, through the per-panel rows route, when the owner's run commits
//      new data -- no reload),
//   3. the "Invalid data" badge on a panel whose Output step failed an error-severity assertion.
// The invariant is on the REQUESTS (dev's superuser connection hides the RLS refusal): while a grantee views, no request goes
// to /api/outputs or /api/pipelines, no /api response is an error and nothing is logged as a console error.
// The run-finish step waits for the status poll (15 s) plus the rows read, so those tests allow 60 s.

const CSRF = { "X-Helio-Requested-With": "1" };
const DEV_PORT = process.env.DEV_PORT ?? "5173";
const BASE_URL = `http://localhost:${DEV_PORT}`;
const RUN = Date.now();
const SOURCE_NAME = `HEL1786 Sales CSV ${RUN}`;
const CHECKED_SOURCE_NAME = `HEL1786 Checked CSV ${RUN}`;
const TABLE_TITLE = `HEL1786 table panel ${RUN}`;
const CHECKED_TITLE = `HEL1786 checked panel ${RUN}`;
const BOARD_NAME = `HEL1786 board ${RUN}`;

interface Actor {
  context: BrowserContext;
  page: Page;
  id: string;
  credentials: Credentials;
}

async function newActor(browser: Browser, label: string): Promise<Actor> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  const credentials = await registerUser(context.request, {
    prefix: "hel1786",
    label,
    displayName: "HEL1786",
  });
  const id = await currentUserId(context.request);
  const page = await context.newPage();
  return { context, page, id, credentials };
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

/** Every request to the Output and pipeline routes, every `/api` error response and every console error, from now on. */
function watchNetwork(page: Page) {
  const outputRoutes: string[] = [];
  const badResponses: string[] = [];
  const consoleErrors: string[] = [];
  const statusReads: string[] = [];
  const onRequest = (request: { url(): string; method(): string }) => {
    const { pathname } = new URL(request.url());
    if (/^\/api\/(outputs|pipelines)(\/|$)/.test(pathname)) {
      outputRoutes.push(`${request.method()} ${pathname}`);
    }
    if (/^\/api\/dashboards\/[^/]+\/panel-status$/.test(pathname)) statusReads.push(pathname);
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
    peek: () => ({ outputRoutes, badResponses, consoleErrors, statusReads }),
    stop() {
      page.off("request", onRequest);
      page.off("response", onResponse);
      page.off("console", onConsole);
      return { outputRoutes, badResponses, consoleErrors, statusReads };
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
let dashboardId: string;
let sourceId: string;
let pipelineId: string;
let checkedPipelineId: string;
let tableOutputId: string;

/** What the freshness fact must read right now, from the owner's own view of both pipelines (the dashboard's latest run, and
 *  its outcome). A wrong "latest item" pick or a wrong status-to-intent mapping on the grantee side makes it differ. */
async function expectedFactPrefix(): Promise<string> {
  const runs: { at: number; status: string }[] = [];
  for (const id of [pipelineId, checkedPipelineId]) {
    const res = await owner.context.request.get(`/api/pipelines/${id}`);
    const p = (await res.json()) as { lastRunAt: string | null; lastRunStatus: string | null };
    if (p.lastRunAt) runs.push({ at: Date.parse(p.lastRunAt), status: p.lastRunStatus ?? "" });
  }
  runs.sort((x, y) => y.at - x.at);
  return runs[0]?.status === "failed" ? "last run failed " : "refreshed ";
}

async function expectFact(text: () => Promise<string>): Promise<void> {
  await expect
    .poll(
      async () => {
        const expected = await expectedFactPrefix();
        return (await text()).startsWith(expected) ? expected : `${expected}<> ${await text()}`;
      },
      { timeout: 15_000 },
    )
    .toMatch(/^(refreshed|last run failed) $/);
}

async function runPipeline(id: string): Promise<void> {
  const run = await owner.context.request.post(`/api/pipelines/${id}/run`, {
    data: {},
    headers: CSRF,
  });
  expect(run.status(), await run.text()).toBeLessThan(300);
}

async function rowCount(outputId: string): Promise<number> {
  const rows = await owner.context.request.get(`/api/outputs/${outputId}/rows`);
  return rows.status() === 200 ? ((await rows.json()) as { total: number }).total : -1;
}

test.describe("HEL-1786 dashboard grantees get freshness, run-finish refresh and the invalid badge", () => {
  test.setTimeout(90_000);

  test.beforeAll(async ({ browser }) => {
    // The three 30 s polls plus the auto-run settle below (<= ~50 s) exceed a hook's default 30 s project timeout (the describe's 90 s applies to tests, not hooks): give the hook its own budget.
    test.setTimeout(180_000);
    owner = await newActor(browser, "owner");
    viewer = await newActor(browser, "viewer");
    editor = await newActor(browser, "editor");
    const api = owner.context.request;

    // Pipeline 2 (the "checked" one): an error-severity range rule. A failing error assertion BLOCKS the run (no snapshot
    // write), so its Output is first materialized by a clean run, then a violating row is appended and the next run is blocked:
    // the Output keeps its old rows and is data-invalid (the badge's premise).
    const checkedSource = await postJson<{ id: string }>(
      api,
      "/api/data-sources",
      {
        name: CHECKED_SOURCE_NAME,
        type: "static",
        columns: [
          { name: "region", type: "string", required: true },
          { name: "revenue", type: "integer", required: true },
        ],
        rows: [
          ["Alpha", 150],
          ["Beta", 160],
        ],
      },
      201,
    );
    const checkedPipeline = await postJson<{ id: string }>(
      api,
      "/api/pipelines",
      { name: `HEL1786 checked pipeline ${RUN}`, roots: [{ sourceId: checkedSource.id }] },
      201,
    );
    checkedPipelineId = checkedPipeline.id;
    const assertStep = await postJson<{ id: string }>(
      api,
      `/api/pipelines/${checkedPipeline.id}/steps`,
      {
        type: "assert",
        config: {
          rules: [{ kind: "range", field: "revenue", params: { min: 120 }, severity: "error" }],
        },
      },
      201,
    );
    const checkedOut = await postJson<{ id: string }>(
      api,
      `/api/pipelines/${checkedPipeline.id}/outputs`,
      { kind: "table", name: "HEL1786 checked", config: {}, nodeStepId: assertStep.id },
      201,
    );
    await runPipeline(checkedPipeline.id);
    await expect.poll(() => rowCount(checkedOut.id), { timeout: 30_000 }).toBe(2);
    await postJson(
      api,
      `/api/data-sources/${checkedSource.id}/rows`,
      { rows: [["Low", 100]] },
      [200, 201],
    );
    await runPipeline(checkedPipeline.id);
    await expect
      .poll(
        async () => {
          const res = await api.get(`/api/outputs/${checkedOut.id}/assertion-status`);
          return res.status() === 200 ? ((await res.json()) as { invalid: boolean }).invalid : null;
        },
        { timeout: 30_000 },
      )
      .toBe(true);
    // The violating-row write above armed a HEL-1093 auto-run that the blocked manual run does not cancel (HEL-1739); it fires
    // on the next scheduler tick after the debounce (<= ~35 s) at a time the test does not control. Its finish flips the
    // owner's latest run to "failed" while a grantee page only learns of it at its next 15 s poll, which is what raced
    // `expectFact` (HEL-1812). No route exposes the armed debounce, so wait on observable run history instead: a TERMINAL
    // run whose triggerSource is "auto-run". After it no further auto-run of this pipeline is armed.
    await expect
      .poll(
        async () => {
          const res = await api.get(`/api/pipelines/${checkedPipeline.id}/run-history`);
          if (res.status() !== 200) return `run-history ${res.status()}`;
          const runs = (await res.json()) as { triggerSource: string; status: string }[];
          return runs.some(
            (r) =>
              r.triggerSource === "auto-run" && (r.status === "succeeded" || r.status === "failed"),
          );
        },
        {
          timeout: 50_000,
          message:
            "the checked pipeline's armed auto-run (5 s debounce + 30 s scheduler tick) never finished",
        },
      )
      .toBe(true);

    // Pipeline 1 (the "live" one): no assertion; the owner appends rows to it and re-runs while a grantee watches. A dataset
    // write also arms an auto-run (HEL-1093) that a blocked manual run does not cancel (HEL-1739), so which pipeline ran
    // last is not fixed by the order above: the freshness assertions derive the expected fact from the owner's own view of both
    // pipelines (`expectedFactPrefix`) instead of assuming one.
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
      { name: `HEL1786 pipeline ${RUN}`, roots: [{ sourceId }] },
      201,
    );
    pipelineId = pipeline.id;
    const tableOut = await postJson<{ id: string }>(
      api,
      `/api/pipelines/${pipelineId}/outputs`,
      { kind: "table", name: "HEL1786 table", config: {} },
      201,
    );
    tableOutputId = tableOut.id;
    await runPipeline(pipelineId);
    await expect.poll(() => rowCount(tableOutputId), { timeout: 30_000 }).toBe(2);
    const dash = await postJson<{ id: string }>(api, "/api/dashboards", { name: BOARD_NAME }, 201);
    dashboardId = dash.id;
    await postJson(
      api,
      "/api/panels",
      { dashboardId, title: TABLE_TITLE, type: "output", config: { outputId: tableOutputId } },
      201,
    );
    await postJson(
      api,
      "/api/panels",
      { dashboardId, title: CHECKED_TITLE, type: "output", config: { outputId: checkedOut.id } },
      201,
    );
    // Dashboard-only grants (no pipeline grant): the Output and pipeline routes refuse these users in production.
    await postJson(
      api,
      `/api/dashboards/${dashboardId}/permissions`,
      { granteeId: viewer.id, role: "viewer" },
      201,
    );
    await postJson(
      api,
      `/api/dashboards/${dashboardId}/permissions`,
      { granteeId: editor.id, role: "editor" },
      201,
    );
  });

  test.afterAll(async () => {
    for (const a of [owner, viewer, editor]) await a?.context.close();
  });

  const cell = (page: Page, text: string) => page.getByRole("cell", { name: text, exact: true });
  const card = (page: Page, title: string) =>
    page.locator("article", { has: page.locator("h3.panel-grid-card__title", { hasText: title }) });

  for (const [role, newRegion] of [
    ["viewer", "North"],
    ["editor", "South"],
  ] as const) {
    test(`${role}: freshness fact, invalid badge and run-finish refresh, through per-panel routes only`, async () => {
      const actor = role === "viewer" ? viewer : editor;
      const page = actor.page;
      const watch = watchNetwork(page);
      await page.goto(`/dashboards/${dashboardId}`);
      await expect(page.getByText("Dashboard not found")).toHaveCount(0);
      await expect(cell(page, "East").first()).toBeVisible();
      await expect(cell(page, "Alpha").first()).toBeVisible();

      // 1. Freshness: the meta row's refresh fact and the source name (from the status route, not the pipeline).
      const facts = page.locator(".dashboard-meta-row__facts");
      // The fact must equal what the owner's view of the latest run says ("refreshed" or "last run failed").
      await expectFact(() => facts.locator(".dashboard-meta-row__refresh").innerText());
      await expect(facts).toContainText(SOURCE_NAME);
      await page.screenshot({ path: evidencePath("HEL-1786", `${role}-freshness.png`) });

      // 3. The invalid badge: on the panel whose Output step failed an error-severity assertion, not on the other one.
      const badge = card(page, CHECKED_TITLE).getByRole("button", {
        name: "Data checks failed - view provenance",
      });
      await expect(badge).toBeVisible();
      await expect(card(page, TABLE_TITLE).getByText("Invalid data")).toHaveCount(0);
      await badge.click();
      await expect(page.getByRole("dialog").first()).toBeVisible();
      await page.screenshot({ path: evidencePath("HEL-1786", `${role}-invalid-badge.png`) });
      await page.keyboard.press("Escape");

      // 2. Run-finish refresh: the owner adds a row and runs; the grantee's table shows it without a reload.
      await expect(cell(page, newRegion)).toHaveCount(0);
      await postJson(
        owner.context.request,
        `/api/data-sources/${sourceId}/rows`,
        { rows: [[newRegion, 200]] },
        [200, 201],
      );
      await runPipeline(pipelineId);
      await expect(cell(page, newRegion).first()).toBeVisible({ timeout: 45_000 });
      await page.screenshot({ path: evidencePath("HEL-1786", `${role}-run-finish.png`) });

      const seen = watch.stop();
      expect(seen.statusReads.length, "panel-status reads").toBeGreaterThan(1);
      expectInvariant(seen);
    });
  }

  test("viewer on a phone: the refreshed caption and the Refresh dashboard control", async () => {
    const context = await viewer.context.browser()!.newContext({
      baseURL: BASE_URL,
      viewport: { width: 390, height: 844 },
      storageState: await viewer.context.storageState(),
    });
    const page = await context.newPage();
    try {
      const watch = watchNetwork(page);
      await page.goto(`/dashboards/${dashboardId}`);
      await expect(page.getByText("Dashboard not found")).toHaveCount(0);
      await expect(cell(page, "East").first()).toBeVisible();
      await expectFact(() =>
        page.locator(".dashboard-refresh-line__text .dashboard-meta-row__refresh").innerText(),
      );
      const before = watch.peek().statusReads.length;
      await page.getByRole("button", { name: "Refresh dashboard" }).click();
      await page.screenshot({ path: evidencePath("HEL-1786", "viewer-phone.png") });
      // The button reads the status once, at once (not after the 15 s poll): exactly one more read than just before the click.
      await expect
        .poll(() => watch.peek().statusReads.length, { timeout: 10_000 })
        .toBe(before + 1);
      expectInvariant(watch.stop());
    } finally {
      await context.close();
    }
  });
});
