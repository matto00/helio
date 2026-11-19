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

// HEL-1773 -- a dashboard GRANTEE (named editor or viewer) opens a shared dashboard in the signed-in app.
//   Stage 1 (206a72d00) proved the claim: `GET /api/dashboards` was owner-only, so `DashboardRoute` showed "Dashboard not
//   found". Child 1 lists the shared dashboards ("Shared" marker), opens them, hides the editing a role does not allow,
//   and reads a non-owned dashboard's panels ONLY through the per-panel routes: the grants here are dashboard-only (no
//   pipeline grant), which the Output and pipeline routes refuse in production (RLS; dev's superuser hides it), so the
//   invariant is on the REQUESTS: while a non-owner views, opens a panel and (editor) edits one, no request goes to
//   /api/outputs or /api/pipelines, no /api response is an error, and nothing is logged as a console error.
// The grants go through the real `POST /api/dashboards/:id/permissions` with an explicit granteeId (an omitted one
// writes a PUBLIC grant and would void the test). Users are registered over the API and deleted by exact id in the
// run's global teardown.

const CSRF = { "X-Helio-Requested-With": "1" };
const DEV_PORT = process.env.DEV_PORT ?? "5173";
const BASE_URL = `http://localhost:${DEV_PORT}`;
const RUN = Date.now();
const TEXT_TITLE = `HEL1773 text panel ${RUN}`;
const OUTPUT_TITLE = `HEL1773 output panel ${RUN}`;
const SHARED_NAME = `HEL1773 shared board ${RUN}`;
const OWN_NAME = `HEL1773 viewer own board ${RUN}`;
const SWITCH_SHARED_NAME = `HEL1773 switch shared ${RUN}`;
const SWITCH_OWN_NAME = `HEL1773 switch own ${RUN}`;
const EDITOR_SOURCE = `HEL1773 editor source ${RUN}`;
const NOT_FOUND = "Dashboard not found";

interface Actor {
  context: BrowserContext;
  page: Page;
  id: string;
  credentials: Credentials;
}

async function newActor(browser: Browser, label: string): Promise<Actor> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  const credentials = await registerUser(context.request, {
    prefix: "hel1773",
    label,
    displayName: "HEL1773",
  });
  const id = await currentUserId(context.request);
  // The register response set the session cookie on the context, so its pages are signed in already.
  const page = await context.newPage();
  return { context, page, id, credentials };
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

/** Records, from `watch()` on, every request to the Output and pipeline routes, every `/api` response that is an error,
 *  and every console error. `stop()` returns what was seen. */
function watchNetwork(page: Page) {
  const outputRoutes: string[] = [];
  const badResponses: string[] = [];
  const consoleErrors: string[] = [];
  const onRequest = (request: { url(): string; method(): string }) => {
    const { pathname } = new URL(request.url());
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

let owner: Actor;
let viewer: Actor;
let editor: Actor;
let stranger: Actor;
let dashboardId: string;
let outputPanelId: string;
let textPanelId: string;
let viewerOwnDashboardId: string;
let switchSharedId: string;
let grants: {
  viewer: { granteeId: string | null; role: string };
  editor: { granteeId: string | null; role: string };
};

// Every test is red-able on its own, but the file seeds once: a failing test restarts the worker and re-seeds.
test.describe("HEL-1773 dashboard grantees open a shared dashboard", () => {
  test.beforeAll(async ({ browser }) => {
    owner = await newActor(browser, "owner");
    viewer = await newActor(browser, "viewer");
    editor = await newActor(browser, "editor");
    stranger = await newActor(browser, "stranger");
    const api = owner.context.request;

    const source = await postJson<{ id: string }>(
      api,
      "/api/data-sources",
      {
        name: "HEL1773 source",
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
    const pipeline = await postJson<{ id: string }>(
      api,
      "/api/pipelines",
      { name: "HEL1773 pipeline", roots: [{ sourceId: source.id }] },
      201,
    );
    const output = await postJson<{ id: string }>(
      api,
      `/api/pipelines/${pipeline.id}/outputs`,
      { kind: "table", name: "HEL1773 table", config: {} },
      201,
    );
    const run = await api.post(`/api/pipelines/${pipeline.id}/run`, { data: {}, headers: CSRF });
    expect(run.status(), await run.text()).toBeLessThan(300);
    // The run may finish after the response: wait until the Output has rows before anyone looks.
    await expect
      .poll(
        async () => {
          const rows = await api.get(`/api/outputs/${output.id}/rows`);
          return rows.status() === 200 ? ((await rows.json()) as { total: number }).total : -1;
        },
        { timeout: 30_000 },
      )
      .toBe(2);
    const dash = await postJson<{ id: string }>(api, "/api/dashboards", { name: SHARED_NAME }, 201);
    dashboardId = dash.id;
    const textPanel = await postJson<{ id: string }>(
      api,
      "/api/panels",
      {
        dashboardId,
        title: TEXT_TITLE,
        type: "markdown",
        config: { content: "HEL1773 body text" },
      },
      201,
    );
    textPanelId = textPanel.id;
    const outputPanel = await postJson<{ id: string }>(
      api,
      "/api/panels",
      { dashboardId, title: OUTPUT_TITLE, type: "output", config: { outputId: output.id } },
      201,
    );
    outputPanelId = outputPanel.id;
    // The REAL grant route, with an explicit granteeId (omitted/null = a PUBLIC grant), dashboard-only (no pipeline grant).
    grants = {
      viewer: await postJson(
        api,
        `/api/dashboards/${dashboardId}/permissions`,
        { granteeId: viewer.id, role: "viewer" },
        201,
      ),
      editor: await postJson(
        api,
        `/api/dashboards/${dashboardId}/permissions`,
        { granteeId: editor.id, role: "editor" },
        201,
      ),
    };
    // The viewer owns one older dashboard; the shared one is touched AFTER it, so it is the newer of the two.
    const own = await postJson<{ id: string }>(
      viewer.context.request,
      "/api/dashboards",
      { name: OWN_NAME },
      201,
    );
    viewerOwnDashboardId = own.id;
    const touched = await api.patch(`/api/dashboards/${dashboardId}`, {
      data: { name: SHARED_NAME },
      headers: CSRF,
    });
    expect(touched.status()).toBe(200);

    // The cycle-2 scenario: the EDITOR owns an Output (its own source and pipeline) that is bound on a dashboard shared with
    // them AND on a dashboard they own.
    const eapi = editor.context.request;
    const esource = await postJson<{ id: string }>(
      eapi,
      "/api/data-sources",
      {
        name: EDITOR_SOURCE,
        type: "static",
        columns: [{ name: "region", type: "string", required: true }],
        rows: [["East"]],
      },
      201,
    );
    const epipeline = await postJson<{ id: string }>(
      eapi,
      "/api/pipelines",
      { name: "HEL1773 editor pipeline", roots: [{ sourceId: esource.id }] },
      201,
    );
    const eoutput = await postJson<{ id: string }>(
      eapi,
      `/api/pipelines/${epipeline.id}/outputs`,
      { kind: "table", name: "HEL1773 editor table", config: {} },
      201,
    );
    const erun = await eapi.post(`/api/pipelines/${epipeline.id}/run`, { data: {}, headers: CSRF });
    expect(erun.status(), await erun.text()).toBeLessThan(300);
    await expect
      .poll(
        async () => {
          const rows = await eapi.get(`/api/outputs/${eoutput.id}/rows`);
          return rows.status() === 200 ? ((await rows.json()) as { total: number }).total : -1;
        },
        { timeout: 30_000 },
      )
      .toBe(1);
    const sharedSwitch = await postJson<{ id: string }>(
      api,
      "/api/dashboards",
      { name: SWITCH_SHARED_NAME },
      201,
    );
    await postJson(
      api,
      `/api/dashboards/${sharedSwitch.id}/permissions`,
      { granteeId: editor.id, role: "editor" },
      201,
    );
    await postJson(
      eapi,
      "/api/panels",
      {
        dashboardId: sharedSwitch.id,
        title: "Switch shared panel",
        type: "output",
        config: { outputId: eoutput.id },
      },
      201,
    );
    const ownSwitch = await postJson<{ id: string }>(
      eapi,
      "/api/dashboards",
      { name: SWITCH_OWN_NAME },
      201,
    );
    await postJson(
      eapi,
      "/api/panels",
      {
        dashboardId: ownSwitch.id,
        title: "Switch own panel",
        type: "output",
        config: { outputId: eoutput.id },
      },
      201,
    );
    switchSharedId = sharedSwitch.id;
  });

  test.afterAll(async () => {
    for (const a of [owner, viewer, editor, stranger]) await a?.context.close();
  });

  const panelTitle = (page: Page, title: string) =>
    page.locator("h3.panel-grid-card__title", { hasText: title });
  const notFoundOf = (page: Page) => page.getByText(NOT_FOUND);
  const tableCell = (scope: Page | Locator, text: string) =>
    scope.getByRole("cell", { name: text, exact: true });

  /** Opens the shared dashboard and waits until the text panel and the Output panel's rows are showing. */
  async function openShared(actor: Actor): Promise<void> {
    await actor.page.goto(`/dashboards/${dashboardId}`);
    await expect(panelTitle(actor.page, TEXT_TITLE).or(notFoundOf(actor.page))).toBeVisible();
    await expect(notFoundOf(actor.page)).toHaveCount(0);
    await expect(panelTitle(actor.page, OUTPUT_TITLE)).toBeVisible();
    await expect(tableCell(actor.page, "East")).toBeVisible();
    await expect(tableCell(actor.page, "West")).toBeVisible();
  }

  async function expectNoEditingControls(page: Page): Promise<void> {
    for (const name of [
      "Edit layout",
      "Add panel",
      "Customize dashboard appearance",
      "Share dashboard",
      "Ask about this dashboard",
    ]) {
      await expect(page.getByRole("button", { name }), `button "${name}"`).toHaveCount(0);
    }
    // The kebab holds only edit/owner items for these roles (Refine with AI, Share, Ask), so a viewer has none.
    await expect(page.getByRole("button", { name: "Dashboard actions" })).toHaveCount(0);
  }

  async function panelMenuItems(page: Page, title: string): Promise<string[]> {
    await page.getByRole("button", { name: `${title} panel actions` }).click();
    const items = await page.getByRole("menuitem").allInnerTexts();
    await page.keyboard.press("Escape");
    return items.map((t) => t.trim());
  }

  test("viewer grantee: signing in lands on their own dashboard, not a newer shared one", async () => {
    await viewer.page.goto("/dashboards");
    const active = viewer.page.locator('button.dashboard-list__button[aria-pressed="true"]');
    await expect(active).toHaveCount(1);
    await expect(active).toHaveAttribute("aria-label", OWN_NAME);
    expect(viewerOwnDashboardId).toBeTruthy();
  });

  test("viewer grantee opens the shared dashboard read-only, through per-panel routes only", async ({
    browserName: _browserName,
  }, testInfo) => {
    // Asserted preconditions: the grant is real, targeted and live on the server.
    expect(grants.viewer.granteeId).toBe(viewer.id);
    expect(grants.viewer.role).toBe("viewer");
    const panels = await viewer.context.request.get(`/api/dashboards/${dashboardId}/panels`);
    expect(panels.status(), "viewer GET /api/dashboards/:id/panels").toBe(200);
    expect(await panels.text()).toContain(TEXT_TITLE);

    // The list: the shared dashboard is in it, with the viewer's role.
    const list = await viewer.context.request.get("/api/dashboards?include=shared");
    expect(list.status()).toBe(200);
    const shared = ((await list.json()) as { items: { id: string; accessRole?: string }[] }).items;
    expect(shared.find((d) => d.id === dashboardId)?.accessRole).toBe("viewer");

    const watch = watchNetwork(viewer.page);
    await openShared(viewer); // positive anchor first: the Output panel's rows are on screen
    await viewer.page.screenshot({ path: evidencePath("HEL-1773", "viewer-dashboard.png") });
    testInfo.annotations.push({ type: "viewer-list", description: `includes=${shared.length}` });

    // The "Shared" marker in the sidebar list: on the shared dashboard, not on the viewer's own one.
    const sharedRow = viewer.page.getByRole("button", { name: `${SHARED_NAME} (Shared)` });
    await expect(sharedRow).toBeVisible();
    await expect(sharedRow.locator(".dashboard-list__shared-badge")).toHaveText("Shared");
    await expect(viewer.page.getByRole("button", { name: OWN_NAME, exact: true })).toBeVisible();
    await expect(
      viewer.page
        .getByRole("button", { name: OWN_NAME, exact: true })
        .locator(".dashboard-list__shared-badge"),
    ).toHaveCount(0);

    // The meta row states only the panel count: its refresh and source facts come from Output and pipeline routes.
    await expect(viewer.page.locator(".dashboard-meta-row__facts")).toHaveText("2 panels");

    // No editing affordance of any kind.
    await expectNoEditingControls(viewer.page);
    expect(await panelMenuItems(viewer.page, OUTPUT_TITLE)).toEqual(["View details"]);
    await expect(
      viewer.page.getByRole("button", { name: `Move ${OUTPUT_TITLE} panel` }),
    ).toHaveCount(0);
    await expect(viewer.page.getByRole("button", { name: `${SHARED_NAME} actions` })).toHaveCount(
      0,
    );

    // Opening a panel's detail view shows its rows from the already-loaded per-panel read: no Edit, no Output link.
    await viewer.page.locator(`article[data-panel-id="${outputPanelId}"]`).click({
      position: { x: 20, y: 60 },
    });
    const dialog = viewer.page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(tableCell(dialog, "East")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Edit panel" })).toHaveCount(0);
    await viewer.page.keyboard.press("e");
    await expect(dialog.getByLabel("Panel title")).toHaveCount(0);
    await expect(dialog.getByRole("link", { name: /output|pipeline/i })).toHaveCount(0);
    await viewer.page.screenshot({ path: evidencePath("HEL-1773", "viewer-panel-detail.png") });
    await viewer.page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    // The list itself and the whole window above: no Output route, no error response, no console error.
    await expect(viewer.page.getByText("Not found")).toHaveCount(0);
    expectInvariant(watch.stop());
  });

  test("viewer grantee: Home lists the shared dashboard with the Shared marker", async () => {
    await viewer.page.goto("/home");
    const card = viewer.page.locator(".home-card", { hasText: SHARED_NAME });
    await expect(card).toBeVisible();
    await expect(card.locator(".home-card__shared")).toContainText("Shared");
    await expect(
      viewer.page.locator(".home-card", { hasText: OWN_NAME }).locator(".home-card__shared"),
    ).toHaveCount(0);
  });

  test("viewer grantee opens the shared dashboard on a phone", async () => {
    const context = await viewer.context.browser()!.newContext({
      baseURL: BASE_URL,
      viewport: { width: 390, height: 844 },
      storageState: await viewer.context.storageState(),
    });
    const page = await context.newPage();
    try {
      const watch = watchNetwork(page);
      await page.goto(`/dashboards/${dashboardId}`);
      await expect(notFoundOf(page)).toHaveCount(0);
      await expect(page.getByText(OUTPUT_TITLE)).toBeVisible();
      await expect(tableCell(page, "East")).toBeVisible();
      await expect(page.getByRole("button", { name: `${SHARED_NAME} (Shared)` })).toBeVisible();
      await page.screenshot({ path: evidencePath("HEL-1773", "viewer-phone.png") });
      expectInvariant(watch.stop());
    } finally {
      await context.close();
    }
  });

  test("editor grantee edits within what the server permits, through per-panel routes only", async () => {
    expect(grants.editor.granteeId).toBe(editor.id);
    expect(grants.editor.role).toBe("editor");
    const watch = watchNetwork(editor.page);
    await openShared(editor);
    await expect(
      editor.page.getByRole("button", { name: `${SHARED_NAME} (Shared)` }),
    ).toBeVisible();

    // Owner-only actions are not offered; editing is.
    await expect(editor.page.getByRole("button", { name: "Share dashboard" })).toHaveCount(0);
    await expect(editor.page.getByRole("button", { name: "Ask about this dashboard" })).toHaveCount(
      0,
    );
    await expect(editor.page.getByRole("button", { name: "Edit layout" })).toBeVisible();
    await expect(editor.page.getByRole("button", { name: "Add panel" })).toBeVisible();
    // The row's kebab is revealed on hover.
    await editor.page.getByRole("button", { name: `${SHARED_NAME} (Shared)` }).hover();
    await editor.page.getByRole("button", { name: `${SHARED_NAME} actions` }).click();
    const sidebarItems = (await editor.page.getByRole("menuitem").allInnerTexts()).map((t) =>
      t.trim(),
    );
    await editor.page.keyboard.press("Escape");
    expect(sidebarItems).toEqual(["Rename", "Export"]);

    // Rename the text panel from its card menu; it persists across a reload.
    const renamed = `${TEXT_TITLE} renamed`;
    await editor.page.getByRole("button", { name: `${TEXT_TITLE} panel actions` }).click();
    await editor.page.getByRole("menuitem", { name: "Rename" }).click();
    const input = editor.page.getByLabel("Panel title");
    await input.fill(renamed);
    await input.press("Enter");
    await expect(panelTitle(editor.page, renamed)).toBeVisible();
    // Panel edits are staged and written by the auto-save; "Save now" flushes them.
    const renameSaved = editor.page.waitForResponse(
      (r) => r.url().includes("/api/panels/updateBatch") && r.request().method() === "POST",
    );
    await editor.page.getByRole("button", { name: "Save now" }).click();
    expect((await renameSaved).status()).toBe(200);
    await editor.page.reload();
    await expect(panelTitle(editor.page, renamed)).toBeVisible();

    // Edit the Output panel's title in its detail modal: the binding is a read-only line, and the save persists.
    const retitled = `${OUTPUT_TITLE} edited`;
    await editor.page.getByRole("button", { name: `${OUTPUT_TITLE} panel actions` }).click();
    await editor.page.getByRole("menuitem", { name: "Customize" }).click();
    const dialog = editor.page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    if (await dialog.getByRole("button", { name: "Edit panel" }).isVisible()) {
      await dialog.getByRole("button", { name: "Edit panel" }).click();
    }
    await expect(dialog.getByText("Bound to an Output")).toBeVisible();
    await dialog.getByLabel("Panel title").fill(retitled);
    await dialog.getByRole("button", { name: "Save panel settings" }).click();
    await expect(dialog.getByLabel("Panel title")).toHaveCount(0);
    await editor.page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(panelTitle(editor.page, retitled)).toBeVisible();
    await editor.page.screenshot({ path: evidencePath("HEL-1773", "editor-dashboard.png") });

    // The panel updates are staged and saved by the auto-save; "Save now" flushes them.
    const retitleSaved = editor.page.waitForResponse(
      (r) => r.url().includes("/api/panels/updateBatch") && r.request().method() === "POST",
    );
    await editor.page.getByRole("button", { name: "Save now" }).click();
    expect((await retitleSaved).status()).toBe(200);
    await editor.page.reload();
    await expect(panelTitle(editor.page, retitled)).toBeVisible();
    expectInvariant(watch.stop());

    // Restore names so a re-run of the file in the same run sees the seeded ones.
    await editor.context.request.patch(`/api/panels/${textPanelId}`, {
      data: { title: TEXT_TITLE },
      headers: CSRF,
    });
    await editor.context.request.patch(`/api/panels/${outputPanelId}`, {
      data: { title: OUTPUT_TITLE },
      headers: CSRF,
    });
  });

  // evaluation-2: a full load of a shared dashboard, then an in-app switch to a COLD owned dashboard binding the same Output.
  // The shared one read the Output through its per-panel route (a stub with no pipeline); the owned one must read the real
  // Output and show its pipeline facts (the source name), exactly as a full load of it would.
  test("editor: switching from a shared dashboard to an owned one binding the same Output shows its facts", async () => {
    await editor.page.goto(`/dashboards/${switchSharedId}`);
    await expect(panelTitle(editor.page, "Switch shared panel")).toBeVisible();
    await expect(tableCell(editor.page, "East")).toBeVisible();
    await editor.page.getByRole("button", { name: SWITCH_OWN_NAME, exact: true }).click();
    await expect(panelTitle(editor.page, "Switch own panel")).toBeVisible();
    await expect(editor.page.locator(".dashboard-meta-row__facts")).toContainText(EDITOR_SOURCE, {
      timeout: 10_000,
    });
  });

  test("owner control: the owner is unchanged (edit controls, no Shared marker)", async () => {
    await openShared(owner);
    await owner.page.screenshot({ path: evidencePath("HEL-1773", "owner-dashboard.png") });
    for (const name of [
      "Edit layout",
      "Add panel",
      "Share dashboard",
      "Ask about this dashboard",
    ]) {
      await expect(owner.page.getByRole("button", { name }), `button "${name}"`).toBeVisible();
    }
    await expect(owner.page.getByRole("button", { name: "Dashboard actions" })).toBeVisible();
    await expect(owner.page.locator(".dashboard-list__shared-badge")).toHaveCount(0);
    await expect(owner.page.getByRole("button", { name: `${SHARED_NAME} actions` })).toBeVisible();
    expect(await panelMenuItems(owner.page, OUTPUT_TITLE)).toEqual([
      "Rename",
      "Customize",
      "Duplicate",
      "Delete",
    ]);
  });

  test("stranger control: a user with no grant gets not-found", async () => {
    const panels = await stranger.context.request.get(`/api/dashboards/${dashboardId}/panels`);
    expect(panels.status(), "stranger GET /api/dashboards/:id/panels").toBe(404);
    const list = await stranger.context.request.get("/api/dashboards?include=shared");
    const ids = ((await list.json()) as { items: { id: string }[] }).items.map((d) => d.id);
    expect(ids).not.toContain(dashboardId);

    await stranger.page.goto(`/dashboards/${dashboardId}`);
    await expect(panelTitle(stranger.page, TEXT_TITLE).or(notFoundOf(stranger.page))).toBeVisible();
    await stranger.page.screenshot({ path: evidencePath("HEL-1773", "stranger-dashboard.png") });
    await expect(notFoundOf(stranger.page)).toBeVisible();
    await expect(panelTitle(stranger.page, TEXT_TITLE)).toHaveCount(0);
  });
});
