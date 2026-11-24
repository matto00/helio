import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { writeFileSync } from "node:fs";

import { attachContextApiCounter, type ContextApiCounter } from "./support/apiRequestCounter";
import { currentUserId, registerUser } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import { LIVE_STACK_ITEMS } from "./support/panelGridReady";

// HEL-1791 -- a compact counter form card in the single-column panel stack (phone, 768 px, and 1100 px with the sidebar
// open) used to collapse to 30-42 px: `.panel-grid-card` is `container-type: size`, which needs a definite height, and
// the stack's intrinsic-height rule listed no `--form` selector, so the card, its `.crossfade` (flex 1, min-height 0)
// and `.panel-content--form` (overflow-y: auto) all shrank and the counter scrolled inside a 24 px body.
// Measured from rendered boxes (jsdom has no layout). No geometry assertion hardcodes a padding value: the phone-only
// card padding does not apply at 1100 px.

const CSRF = { "X-Helio-Requested-With": "1" };
const DEV_PORT = process.env.DEV_PORT ?? "5173";
const BASE_URL = `http://localhost:${DEV_PORT}`;
const RUN = Date.now();
const WIDTHS = [390, 768, 1100] as const;
const THEMES = ["light", "dark"] as const;
const CAPTION = "Your net change this session";
const COUNTER_TITLE = `HEL1791 counter ${RUN}`;
const LABEL = process.env.HEL1791_LABEL ?? "run";

interface Actor {
  context: BrowserContext;
  id: string;
  /** Every `/api` request this principal made, as the rate limiter charges them (HEL-1830). */
  counted: ContextApiCounter;
}

async function newActor(browser: Browser, label: string): Promise<Actor> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  // Attached before the first call on `context.request`, so the registration and every seeding call are counted.
  const counted = attachContextApiCounter(context);
  await registerUser(context.request, { prefix: "hel1791", label, displayName: "HEL1791" });
  return { context, id: await currentUserId(context.request), counted };
}

async function postJson<T>(request: APIRequestContext, url: string, data: unknown): Promise<T> {
  const res = await request.post(url, { data, headers: CSRF });
  expect(res.status(), `${url}: ${await res.text()}`).toBeLessThan(300);
  return (await res.json()) as T;
}

/** HEL-1830: the request-count log line (the AC's "each owner test's request count is logged") and its annotation.
 *  `max-60s` is the largest number of charged requests in any sliding 60 s span: an upper bound on any fixed-window
 *  count, to be read against the limiter's 120. Logged, never asserted: a geometry test must not fail on app polling. */
function logRequestCount(title: string, label: string, actor: Actor): void {
  const line = `${title} principal=${label} ${actor.counted.line()}`;
  console.log(`REQUEST-COUNT ${line}`);
  test.info().annotations.push({ type: "request-count", description: line });
}

interface Board {
  dashboardId: string;
  pipelineId: string;
  sourceIds: string[];
}

/** The seven-panel dashboard every geometry test opens, seeded as `api`'s principal, optionally shared as `editor`. */
async function seedBoard(api: APIRequestContext, at: string, editors: Actor[]): Promise<Board> {
  const counterSource = await postJson<{ id: string }>(api, "/api/data-sources", {
    name: `HEL1791 counts ${RUN}`,
    type: "static",
    columns: [
      { name: "occurred_at", type: "timestamp" },
      { name: "delta", type: "integer", required: true },
      { name: "value", type: "integer" },
    ],
    rows: [],
  });
  const noteSource = await postJson<{ id: string }>(api, "/api/data-sources", {
    name: `HEL1791 notes ${RUN}`,
    type: "static",
    columns: [
      { name: "note", type: "string", required: true },
      { name: "qty", type: "integer" },
    ],
    rows: [],
  });
  const chartSource = await postJson<{ id: string }>(api, "/api/data-sources", {
    name: `HEL1791 chart ${RUN}`,
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
  const pipeline = await postJson<{ id: string }>(api, "/api/pipelines", {
    name: `HEL1791 pipeline ${RUN}`,
    roots: [{ sourceId: chartSource.id }],
  });
  const board: Board = {
    dashboardId: "",
    pipelineId: pipeline.id,
    sourceIds: [counterSource.id, noteSource.id, chartSource.id],
  };
  const output = await postJson<{ id: string }>(api, `/api/pipelines/${pipeline.id}/outputs`, {
    kind: "chart",
    name: `HEL1791 output ${RUN}`,
    config: { chartType: "bar", fieldMapping: { xAxis: "region", yAxis: "revenue" } },
  });
  await postJson(api, `/api/pipelines/${pipeline.id}/run`, {});
  board.dashboardId = (
    await postJson<{ id: string }>(api, "/api/dashboards", { name: `HEL1791 ${RUN}` })
  ).id;
  const { dashboardId } = board;
  const panel = (title: string, type: string, config: unknown) =>
    postJson(api, "/api/panels", { dashboardId, title, type, config });
  await panel("Output panel", "output", { outputId: output.id });
  await panel("Text panel", "text", { content: "Ticker text" });
  await panel("Markdown panel", "markdown", { content: "# Heading\nBody text body text" });
  await panel("Image panel", "image", { imageUrl: "/favicon.svg", imageFit: "cover" });
  await panel("Divider panel", "divider", { orientation: "horizontal" });
  await panel("Multi-field form", "form", {
    dataSourceId: noteSource.id,
    fields: [
      { sourceField: "note", control: "text", label: "Note" },
      { sourceField: "qty", control: "number", label: "Quantity" },
    ],
    submit: { writeMode: "append" },
  });
  await panel(COUNTER_TITLE, "form", {
    dataSourceId: counterSource.id,
    fields: [{ sourceField: "delta", control: "counter", label: "Widgets", step: 5 }],
    submit: { writeMode: "append", resetOnSuccess: false },
  });
  for (const editor of editors)
    await postJson(api, `/api/dashboards/${dashboardId}/permissions`, {
      granteeId: editor.id,
      role: "editor",
    });
  // HEL-1830: the page must open the board in the state a settled one is in, so the pipeline's run is finished first
  // (its polls are charged to the principal and counted, never a fixed sleep).
  await expect
    .poll(
      async () => {
        const res = await api.get(`/api/pipelines/${pipeline.id}`);
        return ((await res.json()) as { lastRunStatus: string | null }).lastRunStatus;
      },
      { message: `${at}: seeded run finished`, intervals: [500, 500, 1000], timeout: 15_000 },
    )
    .toMatch(/^(succeeded|failed)$/);
  return board;
}

/** Deletes what `seedBoard` created, dashboard first, then the pipeline (and its Output), then the sources. */
async function deleteBoard(api: APIRequestContext, board: Board): Promise<void> {
  const urls = [
    `/api/dashboards/${board.dashboardId}`,
    `/api/pipelines/${board.pipelineId}`,
    ...board.sourceIds.map((id) => `/api/data-sources/${id}`),
  ];
  for (const url of urls) {
    const res = await api.delete(url, { headers: CSRF });
    if (res.status() >= 300)
      console.warn(`HEL-1830 cleanup: DELETE ${url} answered ${res.status()}`);
  }
}

// The editor tests and the per-kind height table share one board, owned by `boardOwner` and granted to `measurer` (in
// the beforeAll) and to each editor test's own editor (in the test). HEL-1830: no owner-role or editor-role geometry
// test spends another test's /api window: each runs as its own principal.
let boardOwner: Actor;
// A third principal for the per-kind height table: the general /api limiter is per principal, and the geometry tests
// already spend most of one user's window on page loads.
let measurer: Actor;
let board: Board;

test.describe("HEL-1791 compact counter height in the panel stack", () => {
  test.setTimeout(90_000);

  test.beforeAll(async ({ browser }) => {
    boardOwner = await newActor(browser, "board-owner");
    measurer = await newActor(browser, "measurer");
    board = await seedBoard(boardOwner.context.request, "board owner", [measurer]);
  });

  test.afterAll(async () => {
    // HEL-1830: the board owner's count (seeding, run wait, the editor grants), logged after its last grant.
    console.log(`REQUEST-COUNT afterAll principal=board-owner ${boardOwner.counted.line()}`);
    await deleteBoard(boardOwner.context.request, board);
    await Promise.all([boardOwner, measurer].map((a) => a.context.close()));
  });

  async function openStack(
    page: Page,
    width: number,
    theme: string,
    target: { id: string; items: number },
  ): Promise<void> {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
    await page.goto(`/dashboards/${target.id}`);
    await expect(page.locator(LIVE_STACK_ITEMS)).toHaveCount(target.items, { timeout: 20_000 });
    await expect(page.getByLabel("Loading panels")).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
  }

  async function expectInside(target: Locator, card: Locator, what: string): Promise<void> {
    await expect(target, `${what} visible`).toBeVisible();
    const [t, c] = await Promise.all([target.boundingBox(), card.boundingBox()]);
    expect(t, `${what} box`).not.toBeNull();
    expect(c, `card box`).not.toBeNull();
    expect(t!.height, `${what} has height`).toBeGreaterThan(0);
    expect(t!.y, `${what} top inside card`).toBeGreaterThanOrEqual(c!.y - 0.5);
    expect(t!.y + t!.height, `${what} bottom inside card`).toBeLessThanOrEqual(
      c!.y + c!.height + 0.5,
    );
  }

  /** One geometry check of the compact counter card: the stack opened at `width` in `theme`, as `role`. Assertions and
   *  messages are the HEL-1791 / HEL-1804 originals, untouched by HEL-1830. */
  async function checkCounterCard(
    page: Page,
    role: "owner" | "editor",
    theme: string,
    width: number,
    target: { id: string; items: number },
  ): Promise<void> {
    const at = `${role} ${theme} ${width}px`;
    await openStack(page, width, theme, target);
    const card = page
      .locator(".mobile-panel-stack__item--form")
      .filter({ has: page.getByRole("spinbutton", { name: "Widgets" }) });
    await expect(card, `${at}: counter card`).toBeVisible();
    await expectInside(page.getByRole("spinbutton", { name: "Widgets" }), card, `${at} value`);
    await expectInside(page.getByRole("button", { name: /increase widgets/i }), card, `${at} +`);
    await expectInside(page.getByRole("button", { name: /decrease widgets/i }), card, `${at} -`);
    const caption = card.getByText(CAPTION);
    if (role === "editor") await expectInside(caption, card, `${at} caption`);
    else await expect(caption, `${at}: owner has no caption`).toHaveCount(0);

    // HEL-1804: the empty alert/status regions must not claim a flex gap slot. The blank band between the last
    // visible content and the bottom of the compact layout's border box is at most its own padding-bottom.
    await expect(
      card.locator(".form-panel-view__alert"),
      `${at}: alert region mounted`,
    ).toHaveAttribute("role", "alert");
    await expect(
      card.locator(".form-panel-view__status"),
      `${at}: status region mounted`,
    ).toHaveAttribute("role", "status");
    const blank = await card.locator(".form-panel-view__compact-counter").evaluate((el) => {
      const box = el.getBoundingClientRect();
      const row =
        el.querySelector(".counter-control__caption") ?? el.querySelector(".counter-control");
      return {
        below: box.bottom - (row as HTMLElement).getBoundingClientRect().bottom,
        padding: parseFloat(getComputedStyle(el).paddingBottom),
      };
    });
    expect(
      blank.below,
      `${at}: blank space below the last content (${blank.below}px) is only the layout padding (${blank.padding}px)`,
    ).toBeLessThanOrEqual(blank.padding + 1);

    const scroll = await card.locator(".panel-content--form").evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(scroll.scrollHeight, `${at}: no inner scroll`).toBeLessThanOrEqual(
      scroll.clientHeight + 1,
    );
    // The whole card must be at least as tall as its own content, not a clipped sliver.
    const heights = await card.evaluate((el) => ({
      card: el.getBoundingClientRect().height,
      content: el.scrollHeight,
      client: el.clientHeight,
    }));
    expect(heights.content, `${at}: card content not clipped`).toBeLessThanOrEqual(
      heights.client + 1,
    );
  }

  // HEL-1830: each OWNER geometry test is its own principal on its own seeded board, one per (theme, width): the shared
  // owner spent 97-99 of its 120-per-60 s window on seeding plus both theme tests (`t1-count-unfixed-shared-owner.txt`),
  // and one owner test per theme still projected over 60 (seeding 17 + run wait + three page loads, about 60).
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      test(`owner: the compact counter card shows value, both buttons with no inner scroll, ${theme}, ${width}px`, async ({
        browser,
      }) => {
        const title = test.info().title;
        const own = await newActor(browser, `owner-${theme}-${width}`);
        const api = own.context.request;
        let ownBoard: Board | undefined;
        try {
          ownBoard = await seedBoard(api, `owner ${theme} ${width}px`, []);
          const page = await own.context.newPage();
          try {
            await checkCounterCard(page, "owner", theme, width, {
              id: ownBoard.dashboardId,
              items: 7,
            });
          } finally {
            await page.close();
          }
        } finally {
          logRequestCount(title, `owner-${theme}-${width}`, own);
          if (ownBoard) await deleteBoard(api, ownBoard);
          await own.context.close();
        }
      });
    }
  }

  for (const theme of THEMES) {
    // HEL-1830: each editor theme test is its own principal (the shared editor reached max-60s 72-80 across both), granted
    // `editor` on the shared board by the board owner (whose requests are counted against the board owner).
    test(`editor: the compact counter card shows value, both buttons and the caption with no inner scroll, ${theme}`, async ({
      browser,
    }) => {
      const title = test.info().title;
      const own = await newActor(browser, `editor-${theme}`);
      try {
        await postJson(
          boardOwner.context.request,
          `/api/dashboards/${board.dashboardId}/permissions`,
          { granteeId: own.id, role: "editor" },
        );
        const page = await own.context.newPage();
        try {
          for (const width of WIDTHS) {
            await checkCounterCard(page, "editor", theme, width, {
              id: board.dashboardId,
              items: 7,
            });
          }
        } finally {
          await page.close();
        }
      } finally {
        logRequestCount(title, `editor-${theme}`, own);
        await own.context.close();
      }
    });
  }

  test("per-kind stack heights at 390/768/1100 (recorded; other kinds must not change)", async () => {
    const page = await measurer.context.newPage();
    const table: Record<string, Record<string, number>> = {};
    try {
      for (const width of WIDTHS) {
        await openStack(page, width, "light", { id: board.dashboardId, items: 7 });
        // Let the chart and image settle so their heights are the steady-state ones.
        await page.waitForTimeout(1500);
        table[String(width)] = await page.evaluate(() => {
          const out: Record<string, number> = {};
          for (const el of Array.from(
            document.querySelectorAll<HTMLElement>(".mobile-panel-stack__item"),
          )) {
            const title =
              el.querySelector(".panel-grid-card__title, h3")?.textContent?.trim() ??
              /mobile-panel-stack__item--(\w+)/.exec(el.className)?.[1] ??
              "unknown";
            out[title.replace(/ \d{10,}$/, "")] =
              Math.round(el.getBoundingClientRect().height * 10) / 10;
          }
          return out;
        });
      }
    } finally {
      await page.close();
      logRequestCount(test.info().title, "measurer", measurer);
    }
    writeFileSync(
      evidencePath("HEL-1791", `heights-${LABEL}.json`),
      JSON.stringify(table, null, 2),
    );
    for (const width of WIDTHS) {
      expect(Object.keys(table[String(width)]).length, `${width}px: all seven cards measured`).toBe(
        7,
      );
    }
  });

  // HEL-1804: a message must still render in the SAME always-mounted region, in flow below the content.
  // HEL-1826: it runs as its OWN owner, on its own one-panel dashboard. The shared `owner` has already spent 115-119 of
  // its 120-per-60 s /api window on the geometry tests above (measured: `t1-probe-evidence.txt`), so on a slower runner
  // the click's `POST .../submit` was answered 429, the status stayed empty and the assertion below failed. The
  // assertions are unchanged; only the principal whose budget they spend is.
  test("owner: a status message and an alert message render in flow in the same live regions", async ({
    browser,
  }) => {
    const title = test.info().title;
    const own = await newActor(browser, "owner-live-regions");
    const api = own.context.request;
    const source = await postJson<{ id: string }>(api, "/api/data-sources", {
      name: `HEL1791 live regions ${RUN}`,
      type: "static",
      columns: [
        { name: "occurred_at", type: "timestamp" },
        { name: "delta", type: "integer", required: true },
        { name: "value", type: "integer" },
      ],
      rows: [],
    });
    const ownDashboard = await postJson<{ id: string }>(api, "/api/dashboards", {
      name: `HEL1791 live regions ${RUN}`,
    });
    await postJson(api, "/api/panels", {
      dashboardId: ownDashboard.id,
      title: COUNTER_TITLE,
      type: "form",
      config: {
        dataSourceId: source.id,
        fields: [{ sourceField: "delta", control: "counter", label: "Widgets", step: 5 }],
        submit: { writeMode: "append", resetOnSuccess: false },
      },
    });
    const page = await own.context.newPage();
    try {
      await openStack(page, 390, "light", { id: ownDashboard.id, items: 1 });
      const card = page
        .locator(".mobile-panel-stack__item--form")
        .filter({ has: page.getByRole("spinbutton", { name: "Widgets" }) });
      await expect(card).toBeVisible();
      const compact = card.locator(".form-panel-view__compact-counter");

      async function expectRegionInFlow(sel: string, role: "status" | "alert", text: RegExp) {
        const region = card.locator(sel);
        const handle = await region.elementHandle();
        expect(handle, `${role} region mounted before the step`).not.toBeNull();
        return {
          async verify(what: string) {
            await expect(region, `${what}: text`).toHaveText(text);
            await expect(region, `${what}: visible`).toBeVisible();
            await expect(region, `${what}: role`).toHaveAttribute("role", role);
            const r = await handle!.evaluate((el, parentSel) => {
              const box = el.getBoundingClientRect();
              const parent = (el.closest(parentSel) as HTMLElement).getBoundingClientRect();
              const content = (
                el.parentElement!.firstElementChild as HTMLElement
              ).getBoundingClientRect();
              return {
                connected: el.isConnected,
                position: getComputedStyle(el).position,
                top: box.top,
                bottom: box.bottom,
                height: box.height,
                contentBottom: content.bottom,
                parentTop: parent.top,
                parentBottom: parent.bottom,
              };
            }, ".form-panel-view__compact-counter");
            expect(r.connected, `${what}: same element still attached`).toBe(true);
            expect(r.position, `${what}: in flow`).toBe("static");
            expect(r.height, `${what}: has height`).toBeGreaterThan(0);
            expect(r.top, `${what}: below the content, no overlap`).toBeGreaterThanOrEqual(
              r.contentBottom - 0.5,
            );
            expect(r.bottom, `${what}: inside the layout`).toBeLessThanOrEqual(
              r.parentBottom + 0.5,
            );
          },
        };
      }

      await expect(compact).toBeVisible();
      const status = await expectRegionInFlow(
        ".form-panel-view__status",
        "status",
        /The row was added\./,
      );
      await page.getByRole("button", { name: /increase widgets/i }).click();
      await status.verify("status message");

      await page.route(/\/api\/panels\/[^/]+\/submit$/, async (route) => {
        // Answered here, so the server and its limiter never see it: not charged to the principal.
        own.counted.markFulfilled(route.request());
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ message: "HEL1804 rejected step" }),
        });
      });
      const alert = await expectRegionInFlow(
        ".form-panel-view__alert",
        "alert",
        /HEL1804 rejected step/,
      );
      await page.getByRole("button", { name: /increase widgets/i }).click();
      await alert.verify("alert message");
    } finally {
      await page.close();
      logRequestCount(title, "owner-live-regions", own);
      await api.delete(`/api/dashboards/${ownDashboard.id}`, { headers: CSRF });
      await api.delete(`/api/data-sources/${source.id}`, { headers: CSRF });
      await own.context.close();
    }
  });
});
