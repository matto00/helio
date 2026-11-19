import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { askFixture, fakeAsk, type AskIds } from "./support/askFixtures";
import { currentUserId, registerUser } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import { setUserTierForTest } from "./support/historySeed";

// HEL-1781 -- a dashboard GRANTEE (named viewer or editor, dashboard-only: no pipeline grant) asks about a shared dashboard.
//   * ONLY the `/ask` response is faked, at the browser seam (page.route), with the committed shared-test-fixtures/ask/*.json
//     bodies (HEL-1746 pattern; no live model call). Everything else runs against the real backend.
//   * The invariant is on the REQUESTS: while a grantee asks and opens a citation's provenance, no request goes to
//     /api/outputs or /api/pipelines (prod RLS refuses them to a dashboard-only grantee; dev's superuser hides it) and no
//     /api response is an error. The provenance read goes through the per-panel route.
//   * The server-side pin: null and the RLS proof are backend specs (AskSeamSpec, AskGranteeRlsSpec).
// Users are registered over the API (plain addresses), set to beta by exact id, and deleted by exact id in global teardown.

const CSRF = { "X-Helio-Requested-With": "1" };
const DEV_PORT = process.env.DEV_PORT ?? "5173";
const BASE_URL = `http://localhost:${DEV_PORT}`;
const QUESTION = "How do revenue and cost compare?";

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "phone", width: 390, height: 844 },
] as const;
type Viewport = (typeof VIEWPORTS)[number];

interface Actor {
  context: BrowserContext;
  page: Page;
  id: string;
}

async function newActor(
  browser: Browser,
  label: string,
  tier: "beta" | "free",
  viewport: Viewport = VIEWPORTS[0],
): Promise<Actor> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: viewport.width, height: viewport.height },
  });
  await registerUser(context.request, { prefix: "hel1781", label, displayName: "HEL1781" });
  const id = await currentUserId(context.request);
  if (tier === "beta")
    console.log(`[HEL-1781 e2e] user ${id}; tier set for ${setUserTierForTest(id, "beta")}`);
  else console.log(`[HEL-1781 e2e] user ${id} left on the free tier`);
  return { context, page: await context.newPage(), id };
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

/** From `watch()` on: every request to the Output and pipeline routes, every `/api` error response, every console error. */
function watchNetwork(page: Page) {
  const outputRoutes: string[] = [];
  const provenance: string[] = [];
  const badResponses: string[] = [];
  const consoleErrors: string[] = [];
  const onConsole = (m: { type(): string; text(): string }) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  };
  const onRequest = (request: { url(): string; method(): string }) => {
    const { pathname } = new URL(request.url());
    if (/^\/api\/(outputs|pipelines)(\/|$)/.test(pathname))
      outputRoutes.push(`${request.method()} ${pathname}`);
    if (/\/provenance$/.test(pathname)) provenance.push(pathname);
  };
  const onResponse = (response: {
    url(): string;
    status(): number;
    request(): { method(): string };
  }) => {
    const { pathname } = new URL(response.url());
    if (pathname.startsWith("/api/") && response.status() >= 400)
      badResponses.push(`${response.status()} ${response.request().method()} ${pathname}`);
  };
  page.on("request", onRequest);
  page.on("response", onResponse);
  page.on("console", onConsole);
  return {
    peek: () => ({ outputRoutes, provenance, badResponses, consoleErrors }),
    stop() {
      page.off("request", onRequest);
      page.off("response", onResponse);
      page.off("console", onConsole);
      return { outputRoutes, provenance, badResponses, consoleErrors };
    },
  };
}

let owner: Actor;
let ids: AskIds;
let dashboardId: string;
let panelIds: string[];
let viewer: Actor;
let editor: Actor;
let free: Actor;

const drawer = (page: Page) => page.getByRole("dialog", { name: "Ask about this dashboard" });

/** Opens the drawer: the meta-row button on desktop, the header kebab item on a phone. */
async function openAsk(page: Page, viewport: Viewport) {
  if (viewport.name === "desktop") {
    await page.getByRole("button", { name: "Ask about this dashboard" }).click();
  } else {
    await page.getByRole("button", { name: "Dashboard actions" }).click();
    await page.getByRole("menuitem", { name: "Ask about this dashboard" }).click();
  }
  await expect(drawer(page)).toBeVisible();
}

async function openDashboard(page: Page) {
  await page.goto(`/dashboards/${dashboardId}`);
  await expect(
    page.locator("article.panel-grid-card").filter({ hasText: "Revenue panel" }),
  ).toBeVisible({
    timeout: 30_000,
  });
}

test.describe("HEL-1781 ask about a shared dashboard", () => {
  test.beforeAll(async ({ browser }) => {
    owner = await newActor(browser, "owner", "beta");
    viewer = await newActor(browser, "viewer", "beta");
    editor = await newActor(browser, "editor", "beta");
    free = await newActor(browser, "free", "free");
    const api = owner.context.request;
    const source = await postJson<{ id: string }>(
      api,
      "/api/data-sources",
      {
        name: "HEL1781 source",
        type: "static",
        columns: [
          { name: "region", type: "string" },
          { name: "amount", type: "integer" },
        ],
        rows: [
          ["east", 500],
          ["west", 575],
        ],
      },
      201,
    );
    const pipeline = await postJson<{ id: string }>(
      api,
      "/api/pipelines",
      { name: "HEL1781 pipeline", roots: [{ sourceId: source.id }] },
      201,
    );
    const rev = await postJson<{ id: string }>(
      api,
      `/api/pipelines/${pipeline.id}/outputs`,
      { kind: "table", name: "Orders table", config: {} },
      201,
    );
    const cost = await postJson<{ id: string }>(
      api,
      `/api/pipelines/${pipeline.id}/outputs`,
      {
        kind: "metric",
        name: "Total amount",
        config: { fieldMapping: { value: "amount" }, aggregation: { value: "amount", agg: "sum" } },
      },
      201,
    );
    await postJson(api, `/api/pipelines/${pipeline.id}/run`, {}, 200);
    const detail = await (await api.get(`/api/pipelines/${pipeline.id}`)).json();
    ids = {
      output1: rev.id,
      output2: cost.id,
      pipeline: pipeline.id,
      root: (detail as { roots: Array<{ id: string }> }).roots[0].id,
    };
    dashboardId = (
      await postJson<{ id: string }>(api, "/api/dashboards", { name: "HEL1781 board" }, 201)
    ).id;
    panelIds = [];
    for (const [title, id] of [
      ["Revenue panel", rev.id],
      ["Total panel", cost.id],
    ] as const) {
      const p = await postJson<{ id: string }>(
        api,
        "/api/panels",
        { dashboardId, title, type: "output", config: { outputId: id } },
        201,
      );
      panelIds.push(p.id);
    }
    // The REAL grant route with an explicit granteeId (omitted = a PUBLIC grant), dashboard-only (no pipeline grant).
    for (const [actor, role] of [
      [viewer, "viewer"],
      [editor, "editor"],
      [free, "viewer"],
    ] as const) {
      await postJson(
        api,
        `/api/dashboards/${dashboardId}/permissions`,
        { granteeId: actor.id, role },
        201,
      );
    }
  });

  test.afterAll(async () => {
    for (const a of [owner, viewer, editor, free]) await a?.context.close();
  });

  for (const viewport of VIEWPORTS) {
    test(`viewer (${viewport.name}): asks, sees a cited answer and no pin, opens provenance through the per-panel route only`, async ({
      browser,
    }) => {
      test.setTimeout(180_000);
      const actor = await newActor(browser, `viewer-${viewport.name}`, "beta", viewport);
      await postJson(
        owner.context.request,
        `/api/dashboards/${dashboardId}/permissions`,
        { granteeId: actor.id, role: "viewer" },
        201,
      );
      const seam = await fakeAsk(actor.page, () => ({
        status: 200,
        body: askFixture("ask-200-no-pin.json", ids),
      }));
      const watch = watchNetwork(actor.page);
      await openDashboard(actor.page);
      await openAsk(actor.page, viewport);
      await actor.page.getByRole("textbox", { name: "Your question" }).fill(QUESTION);
      await actor.page.keyboard.press("Enter");
      const answer = drawer(actor.page).getByRole("region", { name: "Answer" });
      await expect(answer).toBeVisible();
      expect(seam.requests).toEqual([
        { path: `/api/dashboards/${dashboardId}/ask`, body: { question: QUESTION } },
      ]);
      await expect(answer.getByRole("button", { name: /pin/i })).toHaveCount(0);
      const chips = answer.getByRole("button", { name: /^Source: amount/ });
      await expect(chips).toHaveCount(2);
      await chips.nth(0).click();
      await expect(actor.page.locator(".provenance-popover")).toBeVisible();
      await expect.poll(() => watch.peek().provenance.length).toBeGreaterThan(0);
      const seen = watch.stop();
      expect(
        seen.provenance.every((p) => p.startsWith(`/api/dashboards/${dashboardId}/panels/`)),
      ).toBe(true);
      expect(seen.outputRoutes, "requests to /api/outputs or /api/pipelines").toEqual([]);
      expect(seen.badResponses, "/api error responses").toEqual([]);
      expect(seen.consoleErrors, "console errors").toEqual([]);
      await expect(
        actor.page.locator(".provenance-popover").getByRole("link", { name: "Open pipeline" }),
      ).toHaveCount(0);
      await actor.page.screenshot({
        path: evidencePath("HEL-1781", `viewer-ask-${viewport.name}.png`),
      });
      await actor.context.close();
    });
  }

  test("editor with no pipeline grant: asks and sees no pin", async () => {
    const seam = await fakeAsk(editor.page, () => ({
      status: 200,
      body: askFixture("ask-200-no-pin.json", ids),
    }));
    await openDashboard(editor.page);
    await openAsk(editor.page, VIEWPORTS[0]);
    await editor.page.getByRole("textbox", { name: "Your question" }).fill(QUESTION);
    await editor.page.keyboard.press("Enter");
    const answer = drawer(editor.page).getByRole("region", { name: "Answer" });
    await expect(answer).toBeVisible();
    expect(seam.requests).toHaveLength(1);
    await expect(answer.getByRole("button", { name: /pin/i })).toHaveCount(0);
  });

  test("free-tier grantee: the upsell, and no ask request", async () => {
    const seam = await fakeAsk(free.page, () => ({
      status: 200,
      body: askFixture("ask-200-no-pin.json", ids),
    }));
    await openDashboard(free.page);
    await openAsk(free.page, VIEWPORTS[0]);
    await expect(
      drawer(free.page).getByText("Asking about your data is on the beta plan."),
    ).toBeVisible();
    await expect(drawer(free.page).getByRole("textbox", { name: "Your question" })).toHaveCount(0);
    expect(seam.requests).toEqual([]);
  });

  test("owner regression: the chip still reads the Output provenance route and a pin is offered", async () => {
    await fakeAsk(owner.page, () => ({ status: 200, body: askFixture("ask-200-pin.json", ids) }));
    const watch = watchNetwork(owner.page);
    await openDashboard(owner.page);
    await openAsk(owner.page, VIEWPORTS[0]);
    await owner.page.getByRole("textbox", { name: "Your question" }).fill(QUESTION);
    await owner.page.keyboard.press("Enter");
    const answer = drawer(owner.page).getByRole("region", { name: "Answer" });
    await expect(answer.getByRole("button", { name: "Pin as insight" })).toBeVisible();
    await answer
      .getByRole("button", { name: /^Source: amount/ })
      .first()
      .click();
    await expect.poll(() => watch.peek().provenance.length).toBeGreaterThan(0);
    expect(watch.stop().provenance[0]).toBe(`/api/outputs/${ids.output1}/provenance`);
  });
});
