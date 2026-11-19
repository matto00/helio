import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";

import { askFixture, fakeAsk, type AskIds } from "./support/askFixtures";
import { currentUserId, registerUser } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import { setUserTierForTest } from "./support/historySeed";
import { loginThenIsolate } from "./support/isolateLivePage";
import { selectRow, showOutputs } from "./support/pipelineSpine";

// HEL-1746 -- the ask UI on the dashboard and the Output sheet, on a real build (C1, the seam):
//   * ONLY the `/ask` response is faked, at the browser network seam (page.route), with the committed
//     `shared-test-fixtures/ask/*.json` bodies, schema-validated here and asserted equal to what the real routes write by the
//     backend's AskSeamSpec. The pin POST, the panel placement and everything after run against the REAL backend.
//   * HEL-1743 (render triggers) is parked: a pinned insight appears PLACED in its not-yet-rendered state. No render, no seed.
//   * the dashboard drawer is driven by keyboard only, focus return is asserted from the meta-row button and from a kebab item,
//     and the drawer's rendered width is measured (540px on desktop, the viewport width on a phone: jest stubs CSS, C2).
// Throwaway users are registered over the API (plain addresses), set to beta by exact id, and deleted by exact id in the run's
// global teardown. Evidence screenshots go to evidencePath("HEL-1746", ...).

const CSRF = { "X-Helio-Requested-With": "1" };
const QUESTION = "How do revenue and cost compare?";
const DEV_PORT = process.env.DEV_PORT ?? "5173";

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "phone", width: 390, height: 844 },
] as const;
type Viewport = (typeof VIEWPORTS)[number];

async function api<T>(
  request: APIRequestContext,
  method: "post" | "get",
  url: string,
  data: unknown,
  status: number,
): Promise<T> {
  const res =
    method === "post"
      ? await request.post(url, { data, headers: CSRF })
      : await request.get(url, { headers: CSRF });
  expect(res.status(), `${url}: ${await res.text()}`).toBe(status);
  return (await res.json()) as T;
}

interface World extends AskIds {
  dashboardId: string;
  filterStepId: string;
}

/** A source, a pipeline with a filter step and two Outputs (a table and a metric), both placed on a new dashboard. */
async function seedWorld(request: APIRequestContext, label: string): Promise<World> {
  const source = await api<{ id: string }>(
    request,
    "post",
    "/api/data-sources",
    {
      name: `HEL-1746 orders ${label}`,
      type: "static",
      columns: [
        { name: "region", type: "string" },
        { name: "amount", type: "integer" },
      ],
      rows: [
        ["east", 500],
        ["west", 575],
        ["north", 640],
      ],
    },
    201,
  );
  const pipeline = await api<{ id: string; roots: Array<{ id: string }> }>(
    request,
    "post",
    "/api/pipelines",
    { name: `HEL-1746 pipeline ${label}`, roots: [{ sourceId: source.id }] },
    201,
  );
  const filter = await api<{ id: string }>(
    request,
    "post",
    `/api/pipelines/${pipeline.id}/steps`,
    {
      type: "filter",
      config: { combinator: "and", conditions: [{ field: "amount", operator: ">=", value: "1" }] },
    },
    201,
  );
  const table = await api<{ id: string }>(
    request,
    "post",
    `/api/pipelines/${pipeline.id}/outputs`,
    { kind: "table", name: "Orders table", config: {} },
    201,
  );
  const metric = await api<{ id: string }>(
    request,
    "post",
    `/api/pipelines/${pipeline.id}/outputs`,
    {
      kind: "metric",
      name: "Total amount",
      config: { fieldMapping: { value: "amount" }, aggregation: { value: "amount", agg: "sum" } },
    },
    201,
  );
  await api(request, "post", `/api/pipelines/${pipeline.id}/run`, {}, 200);
  const dashboard = await api<{ id: string }>(
    request,
    "post",
    "/api/dashboards",
    { name: `HEL-1746 board ${label}` },
    201,
  );
  for (const [title, id] of [
    ["Orders", table.id],
    ["Total", metric.id],
  ] as const) {
    await api(
      request,
      "post",
      "/api/panels",
      { dashboardId: dashboard.id, title, type: "output", config: { outputId: id } },
      201,
    );
  }
  const detail = await api<{ roots: Array<{ id: string }> }>(
    request,
    "get",
    `/api/pipelines/${pipeline.id}`,
    undefined,
    200,
  );
  console.log(
    `[HEL-1746 e2e] created source ${source.id} pipeline ${pipeline.id} outputs ${table.id} ${metric.id} dashboard ${dashboard.id}`,
  );
  return {
    output1: table.id,
    output2: metric.id,
    pipeline: pipeline.id,
    root: detail.roots[0].id,
    dashboardId: dashboard.id,
    filterStepId: filter.id,
  };
}

/** A throwaway user (plain address), beta by exact id, logged in on `page` and left idle on about:blank. */
async function newUser(
  page: Page,
  request: APIRequestContext,
  label: string,
  tier: "beta" | "free",
): Promise<{ id: string }> {
  const credentials = await registerUser(request, {
    prefix: "hel1746",
    label,
    displayName: "HEL-1746",
    logEmail: false,
  });
  const id = await currentUserId(request);
  if (tier === "beta")
    console.log(`[HEL-1746 e2e] user ${id}; tier set for ${setUserTierForTest(id, "beta")}`);
  else console.log(`[HEL-1746 e2e] user ${id} left on the free tier`);
  await loginThenIsolate(page, credentials);
  return { id };
}

async function collaborator(
  browser: Browser,
  baseURL: string | undefined,
  viewport: Viewport,
  theme: string,
) {
  const context = await browser.newContext({ baseURL, viewport });
  await context.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
  const page = await context.newPage();
  return { context, page };
}

function assertLanePort(page: Page) {
  const origin = new URL(page.url()).origin;
  expect(origin, "the page must be on this lane's dev server").toBe(`http://localhost:${DEV_PORT}`);
}

const drawer = (page: Page) => page.getByRole("dialog", { name: "Ask about this dashboard" });
const askField = (scope: Page | Locator) => scope.getByRole("textbox", { name: "Your question" });

/** The ask opener: the meta-row button on desktop, the phone header's kebab item on a phone (keyboard only). */
async function openAskByKeyboard(page: Page, viewport: Viewport): Promise<Locator> {
  if (viewport.name === "desktop") {
    const button = page.getByRole("button", { name: "Ask about this dashboard" });
    await expect(button).toBeVisible({ timeout: 15_000 });
    await button.focus();
    await page.keyboard.press("Enter");
    return button;
  }
  const kebab = page.getByRole("button", { name: "Dashboard actions" });
  await kebab.focus();
  await page.keyboard.press("Enter");
  const item = page.getByRole("menuitem", { name: "Ask about this dashboard" });
  await expect(item).toBeVisible();
  // The menu opens on its first item; arrow down to Ask, as a keyboard user does.
  for (let i = 0; i < 8 && !(await item.evaluate((el) => el === document.activeElement)); i += 1) {
    await page.keyboard.press("ArrowDown");
  }
  await expect(item).toBeFocused();
  await page.keyboard.press("Enter");
  return kebab;
}

async function openDashboard(page: Page, dashboardId: string) {
  await page.goto(`/dashboards/${dashboardId}`);
  assertLanePort(page);
  await expect(page.locator("article.panel-grid-card").filter({ hasText: "Orders" })).toBeVisible({
    timeout: 30_000,
  });
}

/** The popover's geometry, hit-test and focus, read in the real page (the chip's provenance popover). */
async function popoverOpenWithFocus(page: Page) {
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const el = document.querySelector<HTMLElement>(".provenance-popover");
        if (!el) return false;
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return (
          getComputedStyle(el).visibility === "visible" &&
          r.width > 0 &&
          r.height > 0 &&
          hit !== null &&
          el.contains(hit) &&
          el.contains(document.activeElement)
        );
      }),
    )
    .toBe(true);
}

for (const theme of ["light", "dark"] as const) {
  for (const viewport of VIEWPORTS) {
    const tag = `${theme} ${viewport.name}`;

    test(`ask: keyboard-only drawer, cited answer, chip provenance, real pin placed (keyless failed state), focus return (${tag})`, async ({
      page,
      request,
    }) => {
      test.setTimeout(240_000);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
      await newUser(page, request, `owner-${theme}-${viewport.name}`, "beta");
      const world = await seedWorld(request, tag);
      const seam = await fakeAsk(page, () => ({
        status: 200,
        body: askFixture("ask-200-pin.json", world),
      }));

      await openDashboard(page, world.dashboardId);
      const opener = await openAskByKeyboard(page, viewport);

      // Opens to the question field, at the width the size and phone rules give it (C2: measured, not a jsdom class).
      await expect(drawer(page)).toBeVisible();
      await expect(askField(page)).toBeFocused();
      // The dialog's entrance animates its size, so the width is read once it has settled.
      await expect
        .poll(async () =>
          drawer(page).evaluate((el) => ({
            width: Math.round(el.getBoundingClientRect().width),
            viewportWidth: document.documentElement.clientWidth,
          })),
        )
        .toEqual(
          viewport.name === "desktop"
            ? { width: 540, viewportWidth: viewport.width }
            : { width: viewport.width, viewportWidth: viewport.width },
        );
      expect(await page.getByRole("combobox").count()).toBe(0);

      // Ask by keyboard: Enter submits exactly one request, {question} only.
      await page.keyboard.type(QUESTION);
      await page.keyboard.press("Enter");
      const answer = drawer(page).getByRole("region", { name: "Answer" });
      await expect(answer).toBeVisible();
      expect(seam.requests).toEqual([
        { path: `/api/dashboards/${world.dashboardId}/ask`, body: { question: QUESTION } },
      ]);
      await expect(drawer(page).locator(".ask-panel > p[role=status]")).toContainText(
        "Answer ready.",
      );
      await expect(askField(page)).toHaveValue(QUESTION);
      await expect(answer).toContainText("Based on Orders table, Total amount");
      // The real markdown renderer: two cited markers become two chips, in citation order.
      const chips = answer.getByRole("button", { name: /^Source: amount/ });
      await expect(chips).toHaveCount(2);
      await expect(chips.nth(0)).toHaveText("1");
      await expect(chips.nth(1)).toHaveText("2");
      expect(await answer.locator("a, img, script, iframe").count()).toBe(0);

      // The shared `ui-modal-btn` recipe: painted at its normal height, with a 44px hit region on a phone (no inflated min-height).
      if (viewport.name === "phone") {
        for (const [name, button] of [
          ["Ask", drawer(page).getByRole("button", { name: "Ask", exact: true })],
          ["Pin as insight", answer.getByRole("button", { name: "Pin as insight" })],
        ] as const) {
          const facts = await button.evaluate((el) => {
            const r = el.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const at = (y: number) => document.elementFromPoint(cx, y) === el;
            return {
              height: Math.round(r.height),
              hitAbove: at(r.top - 5),
              hitBelow: at(r.bottom + 5),
              hitFar: at(r.top - 14),
            };
          });
          console.log(`[HEL-1746 e2e] ${name} button at 390px: ${JSON.stringify(facts)}`);
          expect(facts.height, name).toBeLessThan(40);
          expect(
            facts.hitAbove && facts.hitBelow,
            `${name} hit region reaches 44px: ${JSON.stringify(facts)}`,
          ).toBe(true);
          expect(facts.hitFar, `${name} hit region stops short of 50px`).toBe(false);
        }
      }

      // A chip opens the cited Output's REAL provenance, anchored in the page; Escape returns focus to the chip.
      await chips.nth(0).focus();
      await page.keyboard.press("Enter");
      await popoverOpenWithFocus(page);
      await page.screenshot({
        path: evidencePath("HEL-1746", `ask-provenance-${theme}-${viewport.name}.png`),
      });
      await page.keyboard.press("Escape");
      await expect(chips.nth(0)).toBeFocused();
      await expect(drawer(page)).toBeVisible();

      // Pin by keyboard: the real POST creates the insight Output, then a panel is placed on the dashboard.
      const pinButton = answer.getByRole("button", { name: "Pin as insight" });
      await expect(pinButton).toBeEnabled();
      await page.screenshot({
        path: evidencePath("HEL-1746", `ask-answer-${theme}-${viewport.name}.png`),
      });
      const created = page.waitForResponse(
        (r) =>
          r.url().includes(`/api/pipelines/${world.pipeline}/outputs`) &&
          r.request().method() === "POST",
      );
      const placed = page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/api/panels" && r.request().method() === "POST",
      );
      await pinButton.focus();
      await page.keyboard.press("Enter");
      const createdRes = await created;
      expect(createdRes.status()).toBe(201);
      const posted = createdRes.request().postDataJSON() as Record<string, unknown>;
      expect(posted).toEqual(
        (askFixture("ask-200-pin.json", world).pin as { request: unknown }).request,
      );
      expect(JSON.stringify(posted)).not.toContain("An amount is");
      const insight = (await createdRes.json()) as { id: string; kind: string };
      expect(insight.kind).toBe("insight");
      expect((await placed).status()).toBe(201);
      await expect(answer.getByText("Pinned.")).toBeVisible();
      await expect(drawer(page).locator(".ask-panel > p[role=status]")).toContainText(
        "Pinned as an insight.",
      );
      await expect(answer.getByRole("button", { name: "Pin as insight" })).toHaveCount(0);
      await page.screenshot({
        path: evidencePath("HEL-1746", `ask-pinned-${theme}-${viewport.name}.png`),
      });

      // Escape closes the drawer and returns focus to the opener (the meta-row button; the kebab trigger on a phone).
      await page.keyboard.press("Escape");
      await expect(drawer(page)).toBeHidden();
      await expect(opener).toBeFocused();

      // The new insight Output is stored, and a panel bound to it is on the dashboard. HEL-1743: the pin starts one render with trigger
      // `pin`; the e2e backend has no model key, so that render is recorded as a no-model `failed` attempt and the panel shows the
      // failed state (the not-yet-rendered state is what it shows only until that first attempt is recorded).
      const outputs = await api<{ items: Array<{ id: string; kind: string; name: string }> }>(
        request,
        "get",
        `/api/pipelines/${world.pipeline}/outputs`,
        undefined,
        200,
      );
      expect(outputs.items.filter((o) => o.kind === "insight").map((o) => o.id)).toEqual([
        insight.id,
      ]);
      const card = page.locator("article.panel-grid-card").filter({ hasText: QUESTION });
      await expect(card.getByText("The last update failed")).toBeVisible({ timeout: 30_000 });
      const read = await api<{ lastAttempt: { status: string; trigger: string } | null }>(
        request,
        "get",
        `/api/outputs/${insight.id}/insight`,
        undefined,
        200,
      );
      expect(read.lastAttempt).toMatchObject({ status: "failed", trigger: "pin" });
      const history = await api<{ items: Array<{ trigger: string }> }>(
        request,
        "get",
        `/api/outputs/${insight.id}/insight/history`,
        undefined,
        200,
      );
      expect(history.items.map((i) => i.trigger)).toEqual(["pin"]); // exactly one attempt, from the one pin render
      await page.screenshot({
        path: evidencePath("HEL-1746", `ask-placed-${theme}-${viewport.name}.png`),
      });
      expect(seam.requests).toHaveLength(1);
    });

    test(`ask: a viewer sees no pin, a free user sees the upsell and sends no ask, and the error states (${tag})`, async ({
      page,
      request,
      browser,
      baseURL,
    }) => {
      test.setTimeout(240_000);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
      await newUser(page, request, `owner2-${theme}-${viewport.name}`, "beta");
      const world = await seedWorld(request, `${tag} viewers`);

      // Error states, on the owner's drawer: each shows its own copy and keeps the question (fixtures, validated against their schemas).
      const script = [
        { status: 200, body: askFixture("ask-200-no-pin.json", world) },
        { status: 422, body: askFixture("ask-422-ungrounded.json", world) },
        { status: 422, body: askFixture("ask-422-truncated.json", world) },
        { status: 503, body: { message: "unavailable" } },
        { status: 200, body: askFixture("ask-200-no-pin.json", world) },
      ];
      const seam = await fakeAsk(page, (n) => script[Math.min(n, script.length - 1)]);
      await openDashboard(page, world.dashboardId);
      await openAskByKeyboard(page, viewport);
      await expect(drawer(page)).toBeVisible();
      // The drawer moves focus to the field after it opens; typing before that would be lost.
      await expect(askField(page)).toBeFocused();
      await page.keyboard.type(QUESTION);
      await page.keyboard.press("Enter");
      const answer = drawer(page).getByRole("region", { name: "Answer" });
      await expect(answer.getByRole("button", { name: /^Source: amount/ })).toHaveCount(2);
      // `pin: null` (the response a viewer gets): no pin action. The server half is AskSeamSpec's viewer case.
      await expect(drawer(page).getByRole("button", { name: /pin/i })).toHaveCount(0);
      const submit = drawer(page).getByRole("button", { name: "Ask", exact: true });
      await submit.click();
      await expect(drawer(page).getByText("Couldn't ground an answer in this data.")).toBeVisible();
      await expect(drawer(page)).not.toContainText("not backed");
      await page.screenshot({
        path: evidencePath("HEL-1746", `ask-ungrounded-${theme}-${viewport.name}.png`),
      });
      await submit.click();
      await expect(
        drawer(page).getByText("That answer ran out of room. Try a narrower question."),
      ).toBeVisible();
      await submit.click();
      await expect(drawer(page).getByText("Ask is unavailable right now.")).toBeVisible();
      await expect(askField(page)).toHaveValue(QUESTION);
      await page.screenshot({
        path: evidencePath("HEL-1746", `ask-unavailable-${theme}-${viewport.name}.png`),
      });
      await drawer(page).getByRole("button", { name: "Retry" }).click();
      await expect(answer).toBeVisible();
      expect(seam.requests.map((r) => r.body)).toEqual(Array(5).fill({ question: QUESTION }));

      // The viewer: a beta user holding a PIPELINE viewer grant. (A dashboard-only grantee cannot open the dashboard in the shell:
      // `GET /api/dashboards` lists owned dashboards only, so the viewer's Ask is the Output sheet's.)
      const viewer = await collaborator(browser, baseURL, viewport, theme);
      await registerUser(viewer.context.request, {
        prefix: "hel1746",
        label: `viewer-${theme}-${viewport.name}`,
        displayName: "HEL-1746",
        logEmail: false,
      });
      const viewerId = await currentUserId(viewer.context.request);
      setUserTierForTest(viewerId, "beta");
      await api(
        request,
        "post",
        `/api/pipelines/${world.pipeline}/permissions`,
        { granteeId: viewerId, role: "viewer" },
        201,
      );
      await fakeAsk(viewer.page, () => ({
        status: 200,
        body: askFixture("ask-200-no-pin.json", world),
      }));
      await viewer.page.goto(`/pipelines/${world.pipeline}`);
      await viewer.page.getByRole("button", { name: "Open Orders table output" }).click();
      const viewerSheet = viewer.page.getByRole("dialog", { name: /^Edit Orders table/ });
      await expect(viewerSheet).toBeVisible();
      await viewerSheet.getByText("Ask about this Output").click();
      await askField(viewerSheet).fill(QUESTION);
      await viewer.page.keyboard.press("Enter");
      await expect(
        viewerSheet
          .getByRole("region", { name: "Answer" })
          .getByRole("button", { name: /^Source: amount/ }),
      ).toHaveCount(2);
      await expect(viewerSheet.getByRole("button", { name: /pin/i })).toHaveCount(0);
      // Bring the answer (and the absence of a pin under it) into frame before the capture.
      await viewerSheet.getByRole("region", { name: "Answer" }).scrollIntoViewIfNeeded();
      await viewer.page.screenshot({
        path: evidencePath("HEL-1746", `ask-viewer-${theme}-${viewport.name}.png`),
      });
      await viewer.context.close();

      // The free-tier user (left as registered): the upsell in place of the field, and zero ask requests.
      const free = await collaborator(browser, baseURL, viewport, theme);
      const freeCredentials = await registerUser(free.context.request, {
        prefix: "hel1746",
        label: `free-${theme}-${viewport.name}`,
        displayName: "HEL-1746",
        logEmail: false,
      });
      console.log(
        `[HEL-1746 e2e] free user ${await currentUserId(free.context.request)} left on the free tier`,
      );
      void freeCredentials;
      let freeAsks = 0;
      free.page.on("request", (r) => {
        if (/\/ask$/.test(new URL(r.url()).pathname)) freeAsks += 1;
      });
      // The free user has no dashboard of the owner's, so open Ask on a dashboard they create.
      const created = await free.context.request.post("/api/dashboards", {
        data: { name: "free board" },
        headers: CSRF,
      });
      expect(created.status()).toBe(201);
      const freeBoard = (await created.json()) as { id: string };
      await free.page.goto(`/dashboards/${freeBoard.id}`);
      await expect(
        free.page
          .getByRole("button", { name: /Ask about this dashboard|Dashboard actions/ })
          .first(),
      ).toBeVisible({ timeout: 30_000 });
      await openAskByKeyboard(free.page, viewport);
      await expect(drawer(free.page)).toBeVisible();
      await expect(
        drawer(free.page).getByText(/Asking about your data is on the beta plan\./),
      ).toBeVisible();
      await expect(
        drawer(free.page).getByRole("link", { name: /Request Beta access/ }),
      ).toHaveAttribute("href", "/settings#beta-access");
      await expect(askField(free.page)).toHaveCount(0);
      await free.page.screenshot({
        path: evidencePath("HEL-1746", `ask-upsell-${theme}-${viewport.name}.png`),
      });
      expect(freeAsks).toBe(0);
      await free.context.close();
    });
  }
}

for (const theme of ["light", "dark"] as const) {
  test(`ask: at a narrow desktop width Ask moves into the kebab and focus returns to the kebab trigger (${theme})`, async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 900, height: 800 });
    await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
    await newUser(page, request, `kebab-${theme}`, "beta");
    const world = await seedWorld(request, `kebab ${theme}`);
    await openDashboard(page, world.dashboardId);
    const row = page.locator(".dashboard-meta-row");
    const rowWidth = await row.evaluate((el) => Math.round(el.getBoundingClientRect().width));
    console.log(`[HEL-1746 e2e] meta row width at 900px viewport: ${rowWidth}`);
    // Below the kebab tier: content width (row minus 40px padding) under 680.
    expect(rowWidth - 40).toBeLessThan(680);
    await expect(page.getByRole("button", { name: "Ask about this dashboard" })).toHaveCount(0);
    const kebab = row.getByRole("button", { name: "Dashboard actions" });
    await kebab.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("menuitem", { name: "Ask about this dashboard" }).click();
    await expect(drawer(page)).toBeVisible();
    await expect(askField(page)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(drawer(page)).toBeHidden();
    await expect(kebab).toBeFocused();
  });

  test(`ask: the Output sheet asks about a saved Output, pins through the real backend, and disables Pin during a draft (${theme})`, async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
    await newUser(page, request, `sheet-${theme}`, "beta");
    const world = await seedWorld(request, `sheet ${theme}`);
    const seam = await fakeAsk(page, () => ({
      status: 200,
      body: askFixture("ask-200-pin.json", world),
    }));

    await page.goto(`/pipelines/${world.pipeline}`);
    assertLanePort(page);
    await showOutputs(page);
    // Create mode has no ask section.
    await page.getByRole("button", { name: "New output" }).click();
    const newSheet = page.getByRole("dialog", { name: /^New output/ });
    await expect(newSheet).toBeVisible();
    await expect(newSheet.getByText("Ask about this Output")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(newSheet).toBeHidden();

    // A saved Output: the group is a closed disclosure; open it with the keyboard, ask, pin.
    await page.getByRole("button", { name: "Open Orders table output" }).click();
    const sheet = page.getByRole("dialog", { name: /^Edit Orders table/ });
    await expect(sheet).toBeVisible();
    const summary = sheet.getByText("Ask about this Output");
    await summary.focus();
    await page.keyboard.press("Enter");
    await askField(sheet).fill(QUESTION);
    await page.keyboard.press("Enter");
    const answer = sheet.getByRole("region", { name: "Answer" });
    await expect(answer).toBeVisible();
    expect(seam.requests).toEqual([
      { path: `/api/outputs/${world.output1}/ask`, body: { question: QUESTION } },
    ]);
    await page.screenshot({ path: evidencePath("HEL-1746", `ask-sheet-${theme}-desktop.png`) });
    const created = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/pipelines/${world.pipeline}/outputs`) &&
        r.request().method() === "POST",
    );
    await answer.getByRole("button", { name: "Pin as insight" }).click();
    expect((await created).status()).toBe(201);
    await expect(answer.getByText("Pinned.")).toBeVisible();
    await expect(answer.getByText(/Pinned as an insight in this pipeline/)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    // The pipeline's Output list gained the insight, with no reload.
    await expect(page.getByRole("button", { name: `Open ${QUESTION} output` })).toBeVisible();

    // While a draft exists, Pin is disabled with the visible reason.
    await selectRow(page, 0);
    await page.locator(".pipeline-detail-page__filter-condition-row input").last().fill("300");
    await expect(page.getByText(/unsaved|draft/i).first()).toBeVisible();
    await page.getByRole("button", { name: "Open Total amount output" }).click();
    const draftSheet = page.getByRole("dialog", { name: /^Edit Total amount/ });
    await expect(draftSheet).toBeVisible();
    await draftSheet.getByText("Ask about this Output").focus();
    await page.keyboard.press("Enter");
    await askField(draftSheet).fill(QUESTION);
    await page.keyboard.press("Enter");
    const draftAnswer = draftSheet.getByRole("region", { name: "Answer" });
    await expect(draftAnswer).toBeVisible();
    await expect(draftAnswer.getByRole("button", { name: "Pin as insight" })).toBeDisabled();
    await expect(draftAnswer.getByText("Save or discard your draft to pin.")).toBeVisible();
    await draftAnswer.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: evidencePath("HEL-1746", `ask-sheet-draft-${theme}-desktop.png`),
    });
  });
  test(`ask: the Output sheet on a phone asks, shows the answer and the pin, in frame (${theme})`, async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
    await newUser(page, request, `sheetphone-${theme}`, "beta");
    const world = await seedWorld(request, `sheetphone ${theme}`);
    await fakeAsk(page, () => ({ status: 200, body: askFixture("ask-200-pin.json", world) }));
    await page.goto(`/pipelines/${world.pipeline}`);
    assertLanePort(page);
    await showOutputs(page);
    await page.getByRole("button", { name: "Open Orders table output" }).click();
    const sheet = page.getByRole("dialog", { name: /^Edit Orders table/ });
    await expect(sheet).toBeVisible();
    await sheet.getByText("Ask about this Output").click();
    await askField(sheet).fill(QUESTION);
    await page.keyboard.press("Enter");
    const answer = sheet.getByRole("region", { name: "Answer" });
    await expect(answer.getByRole("button", { name: /^Source: amount/ })).toHaveCount(2);
    await expect(answer.getByRole("button", { name: "Pin as insight" })).toBeEnabled();
    await answer.evaluate((el) => el.scrollIntoView({ block: "center" }));
    const overflowX = await sheet.evaluate((d) => d.scrollWidth - d.clientWidth);
    expect(overflowX).toBe(0);
    await page.screenshot({ path: evidencePath("HEL-1746", `ask-sheet-${theme}-phone.png`) });
  });
}
