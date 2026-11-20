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

// HEL-1782 -- the read-only shell around a shared dashboard.
//   Viewer: "View only" in the desktop meta row and the phone meta line; ctrl+Z inert; no "Add panel" in the palette; the phone
//   chip's "Shared" badge is the sidebar's badge. Editor (phone): no "View only", no Share on the shared row. A user who owns
//   nothing: the newest shared dashboard opens, Home and the "Build your own dashboard" row offer the drop zone. The owner:
//   none of it. Pull-to-refresh / Refresh dashboard stay on the per-panel routes (no /api/outputs or /api/pipelines request).
// Grants go through the real `POST /api/dashboards/:id/permissions` with an explicit granteeId. Users are registered over the
// API and deleted by exact id in the run's global teardown.

const CSRF = { "X-Helio-Requested-With": "1" };
const DEV_PORT = process.env.DEV_PORT ?? "5173";
const BASE_URL = `http://localhost:${DEV_PORT}`;
const RUN = Date.now();
const OLD_NAME = `HEL1782 older shared ${RUN}`;
const NEW_NAME = `HEL1782 newer shared ${RUN}`;
const OWN_NAME = `HEL1782 owner board ${RUN}`;
const OUTPUT_TITLE = `HEL1782 output panel ${RUN}`;

interface Actor {
  context: BrowserContext;
  page: Page;
  id: string;
}

async function newActor(browser: Browser, label: string): Promise<Actor> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await registerUser(context.request, { prefix: "hel1782", label, displayName: "HEL1782" });
  const id = await currentUserId(context.request);
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

function watchNetwork(page: Page) {
  const outputRoutes: string[] = [];
  const badResponses: string[] = [];
  const layoutWrites: string[] = [];
  const onRequest = (request: { url(): string; method(): string }) => {
    const { pathname } = new URL(request.url());
    if (/^\/api\/(outputs|pipelines)(\/|$)/.test(pathname)) {
      outputRoutes.push(`${request.method()} ${pathname}`);
    }
    if (request.method() === "PATCH" && pathname.startsWith("/api/dashboards/")) {
      layoutWrites.push(pathname);
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
  page.on("request", onRequest);
  page.on("response", onResponse);
  return {
    stop() {
      page.off("request", onRequest);
      page.off("response", onResponse);
      return { outputRoutes, badResponses, layoutWrites };
    },
  };
}

let owner: Actor;
let viewer: Actor;
let editor: Actor;
let oldId: string;
let newId: string;

const BADGE_PROPS = [
  "fontSize",
  "fontFamily",
  "fontWeight",
  "letterSpacing",
  "textTransform",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderTopLeftRadius",
] as const;

async function badgeStyle(page: Page, selector: string, withColours: boolean) {
  return page
    .locator(selector)
    .first()
    .evaluate(
      (el, args) => {
        const cs = getComputedStyle(el);
        const out: Record<string, string> = {};
        for (const prop of args.props) out[prop] = cs[prop as never] as string;
        if (args.withColours) {
          out.backgroundColor = cs.backgroundColor;
          out.color = cs.color;
        }
        return out;
      },
      { props: [...BADGE_PROPS], withColours },
    );
}

test.describe("HEL-1782 read-only viewer shell", () => {
  test.beforeAll(async ({ browser }) => {
    owner = await newActor(browser, "owner");
    viewer = await newActor(browser, "viewer");
    editor = await newActor(browser, "editor");
    const api = owner.context.request;

    const source = await postJson<{ id: string }>(
      api,
      "/api/data-sources",
      {
        name: "HEL1782 source",
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
      { name: "HEL1782 pipeline", roots: [{ sourceId: source.id }] },
      201,
    );
    const output = await postJson<{ id: string }>(
      api,
      `/api/pipelines/${pipeline.id}/outputs`,
      { kind: "table", name: "HEL1782 table", config: {} },
      201,
    );
    const run = await api.post(`/api/pipelines/${pipeline.id}/run`, { data: {}, headers: CSRF });
    expect(run.status(), await run.text()).toBeLessThan(300);
    await expect
      .poll(
        async () => {
          const rows = await api.get(`/api/outputs/${output.id}/rows`);
          return rows.status() === 200 ? ((await rows.json()) as { total: number }).total : -1;
        },
        { timeout: 30_000 },
      )
      .toBe(2);

    const older = await postJson<{ id: string }>(api, "/api/dashboards", { name: OLD_NAME }, 201);
    oldId = older.id;
    const newer = await postJson<{ id: string }>(api, "/api/dashboards", { name: NEW_NAME }, 201);
    newId = newer.id;
    await postJson(
      api,
      "/api/panels",
      { dashboardId: newId, title: OUTPUT_TITLE, type: "output", config: { outputId: output.id } },
      201,
    );
    await postJson(api, "/api/dashboards", { name: OWN_NAME }, 201);
    // Both shared dashboards go to the viewer and the editor (who each own nothing); the newer one is touched last.
    for (const grantee of [viewer, editor]) {
      for (const id of [oldId, newId]) {
        await postJson(
          api,
          `/api/dashboards/${id}/permissions`,
          { granteeId: grantee.id, role: grantee === viewer ? "viewer" : "editor" },
          201,
        );
      }
    }
    const touched = await api.patch(`/api/dashboards/${newId}`, {
      data: { name: NEW_NAME },
      headers: CSRF,
    });
    expect(touched.status()).toBe(200);
  });

  test.afterAll(async () => {
    for (const a of [owner, viewer, editor]) await a?.context.close();
  });

  test("a user who owns nothing lands on the newest shared dashboard, read-only", async () => {
    const page = viewer.page;
    const watch = watchNetwork(page);
    await page.goto("/dashboards");
    await expect(
      page.locator("h3.panel-grid-card__title", { hasText: OUTPUT_TITLE }),
    ).toBeVisible();
    await expect(page.getByText("No dashboard open")).toHaveCount(0);
    await expect(page.locator(".dashboard-meta-row__facts")).toContainText("View only");
    await page.screenshot({ path: evidencePath("HEL-1782", "viewer-desktop.png") });

    // ctrl+Z does nothing: no layout write, and the key is not swallowed.
    const prevented = await page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          window.addEventListener(
            "keydown",
            (e) => queueMicrotask(() => resolve(e.defaultPrevented)),
            {
              once: true,
            },
          );
          window.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "z",
              ctrlKey: true,
              bubbles: true,
              cancelable: true,
            }),
          );
        }),
    );
    expect(prevented).toBe(false);
    expect(watch.stop().layoutWrites).toEqual([]);

    // The palette offers no editing entry but keeps the caller's own creations.
    await page.keyboard.press("Control+k");
    await page.fill('input[aria-label="Search commands"]', "dashboard");
    await expect(page.getByRole("option", { name: "New dashboard" })).toBeVisible();
    await page.fill('input[aria-label="Search commands"]', "panel");
    await expect(page.getByRole("option", { name: "Add panel" })).toHaveCount(0);
    await page.keyboard.press("Escape");
  });

  test("Home and the sidebar entry offer the first-run drop zone to a shared-only user", async () => {
    const page = viewer.page;
    await page.goto("/home");
    await expect(page.locator(".home-card", { hasText: NEW_NAME })).toBeVisible();
    await expect(page.getByRole("region", { name: "Build your first dashboard" })).toBeVisible();

    await page.goto("/dashboards");
    await expect(page.locator(".dashboard-meta-row__facts")).toContainText("View only");
    // The row's label is one line inside its row, in the list rows' own type (evaluation-1 CR2).
    const buildOwn = page.locator(".dashboard-list__build-own");
    const box = await buildOwn.evaluate((el) => ({
      overflows: el.scrollHeight > el.clientHeight,
      fontSize: getComputedStyle(el.querySelector(".dashboard-list__name")!).fontSize,
      weight: getComputedStyle(el.querySelector(".dashboard-list__name")!).fontWeight,
    }));
    const sibling = await page
      .locator(".dashboard-list__button .dashboard-list__name")
      .first()
      .evaluate((el) => ({
        fontSize: getComputedStyle(el).fontSize,
        weight: getComputedStyle(el).fontWeight,
      }));
    expect(box.overflows).toBe(false);
    expect({ fontSize: box.fontSize, weight: box.weight }).toEqual(sibling);
    await page.screenshot({ path: evidencePath("HEL-1782", "sidebar-build-own.png") });
    await buildOwn.click();
    await expect(page).toHaveURL(/\/dashboards\/?$/);
    await expect(page.getByRole("region", { name: "Build your first dashboard" })).toBeVisible();
    await expect(page.getByText("No dashboard open")).toHaveCount(0);
    await page.screenshot({ path: evidencePath("HEL-1782", "shared-only-drop-zone.png") });

    // "Set up step by step" shows only the checklist; dismissing it returns the drop zone (never a blank pane or
    // "No dashboard open"), and choosing the entry again keeps it there.
    const dropZone = page.getByRole("region", { name: "Build your first dashboard" });
    await page.getByRole("button", { name: "Set up step by step" }).click();
    await expect(page.getByRole("region", { name: "Getting started" })).toBeVisible();
    await expect(page.getByText("No dashboard open")).toHaveCount(0);
    await expect(dropZone).toHaveCount(0);
    await page.getByRole("button", { name: "Dismiss getting-started checklist" }).click();
    await expect(dropZone).toBeVisible();
    await expect(page.getByText("No dashboard open")).toHaveCount(0);
    await page.getByRole("button", { name: "Build your own dashboard" }).click();
    await expect(dropZone).toBeVisible();
    await page.screenshot({ path: evidencePath("HEL-1782", "shared-only-after-dismiss.png") });
  });

  test("viewer on a phone: View only on the meta line, one Shared badge, refresh on per-panel routes", async () => {
    const context = await viewer.context.browser()!.newContext({
      baseURL: BASE_URL,
      viewport: { width: 390, height: 844 },
      storageState: await viewer.context.storageState(),
    });
    const page = await context.newPage();
    try {
      const watch = watchNetwork(page);
      await page.goto(`/dashboards/${newId}`);
      await expect(page.getByRole("cell", { name: "East", exact: true })).toBeVisible();
      await expect(page.locator(".dashboard-refresh-line__text")).toContainText("View only");

      // The inactive chip carries the sidebar badge's declarations exactly; the active one only inverts its colours.
      const chipBadge = ".dashboard-chip:not(.dashboard-chip--active) .dashboard-chip__shared";
      const phoneBadge = await badgeStyle(page, chipBadge, true);
      const desktop = await viewer.context.browser()!.newContext({
        baseURL: BASE_URL,
        viewport: { width: 1280, height: 800 },
        storageState: await viewer.context.storageState(),
      });
      const dpage = await desktop.newPage();
      try {
        await dpage.goto(`/dashboards/${newId}`);
        await expect(dpage.locator(".dashboard-list__shared-badge").first()).toBeVisible();
        const sidebarBadge = await badgeStyle(dpage, ".dashboard-list__shared-badge", true);
        expect(phoneBadge).toEqual(sidebarBadge);
      } finally {
        await desktop.close();
      }
      await page.screenshot({ path: evidencePath("HEL-1782", "viewer-phone.png") });

      await page.getByRole("button", { name: "Refresh dashboard" }).click();
      await expect(page.getByRole("cell", { name: "East", exact: true })).toBeVisible();
      const seen = watch.stop();
      expect(seen.outputRoutes, "requests to /api/outputs or /api/pipelines").toEqual([]);
      expect(seen.badResponses, "/api error responses").toEqual([]);

      // The sheet offers the shared-only user the build-your-own row, and no Share on a shared row.
      await page.getByRole("button", { name: /Switch dashboards/i }).click();
      const sheet = page.getByRole("dialog");
      await expect(sheet.getByRole("button", { name: "Build your own dashboard" })).toBeVisible();
      await expect(sheet.getByRole("button", { name: /^Share / })).toHaveCount(0);
      await page.screenshot({ path: evidencePath("HEL-1782", "viewer-phone-sheet.png") });
    } finally {
      await context.close();
    }
  });

  test("editor on a phone: no View only, no Share on the shared row", async () => {
    const context = await editor.context.browser()!.newContext({
      baseURL: BASE_URL,
      viewport: { width: 390, height: 844 },
      storageState: await editor.context.storageState(),
    });
    const page = await context.newPage();
    try {
      const watch = watchNetwork(page);
      await page.goto(`/dashboards/${newId}`);
      await expect(page.getByRole("cell", { name: "East", exact: true })).toBeVisible();
      await expect(page.getByText("View only")).toHaveCount(0);
      await page.getByRole("button", { name: "Refresh dashboard" }).click();
      await expect(page.getByRole("cell", { name: "East", exact: true })).toBeVisible();
      await page.getByRole("button", { name: /Switch dashboards/i }).click();
      const sheet = page.getByRole("dialog");
      await expect(sheet.getByRole("button", { name: /^Share / })).toHaveCount(0);
      const seen = watch.stop();
      expect(seen.outputRoutes, "requests to /api/outputs or /api/pipelines").toEqual([]);
      expect(seen.badResponses, "/api error responses").toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("the owner sees no View only and no Build your own entry", async () => {
    const page = owner.page;
    await page.goto("/dashboards");
    await expect(page.locator(".dashboard-meta-row__facts")).toBeVisible();
    await expect(page.getByText("View only")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Build your own dashboard" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Share dashboard" })).toBeVisible();
  });
});
