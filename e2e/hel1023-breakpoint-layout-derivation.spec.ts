import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// HEL-1023 — a breakpoint with no usable saved layout must be derived/repaired AT RENDER so panels
// never overlap or leave the container, while a valid authored layout renders exactly as saved and
// a mere view never persists anything. Real browser, real RGL, geometry read from the rendered
// `.react-grid-item` rects (never the store). Mixed kinds: markdown, image, chart (output panel
// bound to a pipeline chart output), text, divider.
//
// Container width, not window width, picks the breakpoint: container = window - 288 with the
// sidebar open, window - 40 under 1056. Windows used: 1900 (lg), 1500 (md), 1200 (sm),
// 1056 (container exactly 768 = sm), 400 (phone stack).

const CSRF_HEADER = { "X-Helio-Requested-With": "1" };
const GRID_MARGIN = 18;
const ROW_HEIGHT = 52;
const COLS = { lg: 12, md: 10, sm: 6, xs: 2 } as const;

type Bp = keyof typeof COLS;
interface Item {
  panelId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
type Layout = Record<Bp, Item[]>;
interface Rect {
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const windows: { width: number; bp: Bp | "stack"; container: number }[] = [
  { width: 1900, bp: "lg", container: 1612 },
  { width: 1500, bp: "md", container: 1212 },
  { width: 1200, bp: "sm", container: 912 },
  { width: 1056, bp: "sm", container: 768 },
  { width: 400, bp: "stack", container: 360 },
];

const titles = [
  "P1 Image",
  "P2 Markdown",
  "P3 Chart",
  "P4 Markdown",
  "P5 Image",
  "P6 Markdown",
  "P7 Text",
  "P8 Divider",
];
const readingOrder = titles;

const seededUsers: string[] = [];
const it = (panelId: string, x: number, y: number, w: number, h: number): Item => ({
  panelId,
  x,
  y,
  w,
  h,
});

async function registerAndLogin(page: Page, request: APIRequestContext) {
  const email = `hel1023-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.test`;
  const password = "correcthorsebattery1";
  const res = await request.post("/api/auth/register", {
    data: { email, password, displayName: "HEL-1023 e2e" },
    headers: CSRF_HEADER,
  });
  expect(res.status()).toBe(201);
  seededUsers.push(email);
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL("/");
}

async function postJson<T>(request: APIRequestContext, url: string, data: unknown): Promise<T> {
  const res = await request.post(url, { data, headers: CSRF_HEADER });
  expect(res.status(), `${url} ${await res.text()}`).toBeLessThan(300);
  return (await res.json()) as T;
}

interface Seeded {
  dashboardId: string;
  ids: Record<"p1" | "p2" | "p3" | "p4" | "p5" | "p6" | "p7" | "p8", string>;
}

async function seedDashboard(request: APIRequestContext): Promise<Seeded> {
  const dash = await postJson<{ id: string }>(request, "/api/dashboards", {
    name: "HEL-1023 e2e",
  });
  const source = await postJson<{ id: string }>(request, "/api/data-sources", {
    name: "HEL-1023 Source",
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
  const pipeline = await postJson<{ id: string }>(request, "/api/pipelines", {
    name: "HEL-1023 Pipeline",
    roots: [{ sourceId: source.id }],
  });
  const output = await postJson<{ id: string }>(request, `/api/pipelines/${pipeline.id}/outputs`, {
    kind: "chart",
    name: "HEL-1023 Chart Output",
    config: { chartType: "bar", fieldMapping: { xAxis: "region", yAxis: "revenue" } },
  });
  await postJson(request, `/api/pipelines/${pipeline.id}/run`, {});
  const panel = (title: string, type: string, config: unknown) =>
    postJson<{ id: string }>(request, "/api/panels", {
      dashboardId: dash.id,
      title,
      type,
      config,
    });
  const defs: [string, string, unknown][] = [
    ["P1 Image", "image", { imageUrl: "/favicon.svg", imageFit: "cover" }],
    ["P2 Markdown", "markdown", { content: "# Top story\nBody text body text" }],
    ["P3 Chart", "output", { outputId: output.id }],
    ["P4 Markdown", "markdown", { content: "## Second\nBody" }],
    ["P5 Image", "image", { imageUrl: "/favicon.svg", imageFit: "cover" }],
    ["P6 Markdown", "markdown", { content: "## Third\nMore body" }],
    ["P7 Text", "text", { content: "Ticker text" }],
    ["P8 Divider", "divider", { orientation: "horizontal" }],
  ];
  const created: string[] = [];
  for (const [title, type, config] of defs) created.push((await panel(title, type, config)).id);
  const [p1, p2, p3, p4, p5, p6, p7, p8] = created;
  return { dashboardId: dash.id, ids: { p1, p2, p3, p4, p5, p6, p7, p8 } };
}

function states(ids: Seeded["ids"]): Record<string, Layout> {
  const { p1, p2, p3, p4, p5, p6, p7, p8 } = ids;
  // Reading order at lg (y, x): P1, P2 / P3, P4 / P5, P6 / P7, P8.
  const lg = [
    it(p1, 0, 0, 4, 6),
    it(p2, 4, 0, 8, 6),
    it(p3, 0, 6, 6, 5),
    it(p4, 6, 6, 6, 5),
    it(p5, 0, 11, 5, 5),
    it(p6, 5, 11, 7, 5),
    it(p7, 0, 16, 6, 3),
    it(p8, 6, 16, 6, 3),
  ];
  const lgCoords = () => lg.map((i) => ({ ...i }));
  return {
    // lg only: md/sm/xs have no layout at all.
    A_lg_only: { lg, md: [], sm: [], xs: [] },
    // md partial: only three panels authored at md, two at sm.
    B_partial: {
      lg,
      md: [it(p1, 0, 0, 4, 6), it(p2, 4, 0, 6, 6), it(p3, 0, 6, 5, 5)],
      sm: [it(p1, 0, 0, 3, 6), it(p2, 3, 0, 3, 6)],
      xs: [],
    },
    // 12-column coordinates stored under md/sm/xs (bounds-violating).
    C_lg_coords_everywhere: { lg, md: lgCoords(), sm: lgCoords(), xs: lgCoords() },
    // md saved layout overlaps.
    D_md_overlap: {
      lg,
      md: [
        it(p1, 0, 0, 5, 6),
        it(p2, 2, 0, 5, 6),
        it(p3, 0, 6, 5, 5),
        it(p4, 3, 6, 7, 5),
        it(p5, 0, 11, 5, 5),
        it(p6, 0, 12, 6, 5),
        it(p7, 5, 16, 5, 3),
        it(p8, 6, 17, 4, 3),
      ],
      sm: [],
      xs: [],
    },
    // Valid authored layout at EVERY breakpoint, with intentional empty rows and column gaps.
    V_valid_with_gaps: {
      lg: [
        it(p1, 0, 0, 4, 4),
        it(p2, 6, 0, 6, 4),
        it(p3, 1, 8, 5, 4),
        it(p4, 8, 8, 4, 4),
        it(p5, 0, 14, 4, 3),
        it(p6, 6, 14, 6, 3),
        it(p7, 0, 20, 5, 2),
        it(p8, 7, 20, 5, 2),
      ],
      md: [
        it(p1, 0, 0, 3, 4),
        it(p2, 5, 0, 5, 4),
        it(p3, 1, 8, 4, 4),
        it(p4, 7, 8, 3, 4),
        it(p5, 0, 14, 3, 3),
        it(p6, 5, 14, 5, 3),
        it(p7, 0, 20, 4, 2),
        it(p8, 6, 20, 4, 2),
      ],
      sm: [
        it(p1, 0, 0, 2, 4),
        it(p2, 3, 0, 3, 4),
        it(p3, 1, 8, 3, 4),
        it(p4, 4, 8, 2, 4),
        it(p5, 0, 14, 2, 3),
        it(p6, 3, 14, 3, 3),
        it(p7, 0, 20, 2, 2),
        it(p8, 4, 20, 2, 2),
      ],
      xs: [
        it(p1, 0, 0, 2, 4),
        it(p2, 0, 6, 2, 4),
        it(p3, 0, 12, 2, 4),
        it(p4, 0, 18, 2, 4),
        it(p5, 0, 24, 2, 4),
        it(p6, 0, 30, 2, 4),
        it(p7, 0, 36, 2, 2),
        it(p8, 0, 40, 2, 2),
      ],
    },
  };
}

async function readRects(page: Page): Promise<{ rects: Rect[]; container: Rect | null }> {
  return page.evaluate(() => {
    const rect = (el: Element, title: string) => {
      const b = el.getBoundingClientRect();
      return { title, x: b.left, y: b.top + window.scrollY, w: b.width, h: b.height };
    };
    const grid = document.querySelector(".panel-grid");
    const stack = document.querySelector(".mobile-panel-stack");
    const host = grid ?? stack;
    const sel = grid ? ".react-grid-item" : ".mobile-panel-stack__item";
    const rects = [...document.querySelectorAll(sel)].map((el) =>
      rect(
        el,
        el.querySelector(".panel-grid-card__title")?.textContent?.trim() ??
          (el.className.includes("--divider") ? "P8 Divider" : el.className),
      ),
    );
    return { rects, container: host ? rect(host, "container") : null };
  });
}

/** RGL animates items; read until two consecutive reads agree. */
async function settledRects(page: Page, expectedCount: number, containerWidth: number) {
  await expect(page.locator(".react-grid-item, .mobile-panel-stack__item")).toHaveCount(
    expectedCount,
    { timeout: 20_000 },
  );
  // After a resize the container re-measures asynchronously; wait for the expected width.
  await expect
    .poll(async () => Math.round((await readRects(page)).container?.w ?? -1), { timeout: 15_000 })
    .toBe(containerWidth);
  let prev = await readRects(page);
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(150);
    const next = await readRects(page);
    const same = next.rects.every(
      (r, idx) =>
        Math.abs(r.x - prev.rects[idx].x) < 0.5 &&
        Math.abs(r.y - prev.rects[idx].y) < 0.5 &&
        Math.abs(r.w - prev.rects[idx].w) < 0.5 &&
        Math.abs(r.h - prev.rects[idx].h) < 0.5,
    );
    if (same) return next;
    prev = next;
  }
  throw new Error("grid never settled");
}

function overlaps(a: Rect, b: Rect): boolean {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return ox > 2 && oy > 2;
}

function expectedRect(item: Item, container: Rect, cols: number): Rect {
  const colW = (container.w - GRID_MARGIN * (cols - 1)) / cols;
  return {
    title: item.panelId,
    x: container.x + item.x * (colW + GRID_MARGIN),
    y: container.y + item.y * (ROW_HEIGHT + GRID_MARGIN),
    w: item.w * colW + (item.w - 1) * GRID_MARGIN,
    h: item.h * ROW_HEIGHT + (item.h - 1) * GRID_MARGIN,
  };
}

function rectsCollide(a: Item, b: Item): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Same validity contract as the app (in bounds, no overlap), for asserting a fixture is really bad. */
function isLayoutValid(items: Item[], cols: number): boolean {
  const inBounds = items.every(
    (i) => i.x >= 0 && i.y >= 0 && i.w >= 1 && i.h >= 1 && i.x + i.w <= cols,
  );
  for (let a = 0; a < items.length; a++)
    for (let b = a + 1; b < items.length; b++) if (rectsCollide(items[a], items[b])) return false;
  return inBounds;
}

/** The API refuses to store an overlapping/out-of-bounds layout, so a stored-bad one is injected into
 * the dashboards list response the browser receives. Register BEFORE navigating. */
async function injectStoredLayout(page: Page, dashboardId: string, layout: Layout) {
  const injections = { count: 0 };
  await page.route(
    (url) => url.pathname === "/api/dashboards",
    async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { items: { id: string; layout: Layout }[] };
      for (const d of body.items) {
        if (d.id === dashboardId) {
          d.layout = layout;
          injections.count++;
        }
      }
      await route.fulfill({ response, json: body });
    },
  );
  return injections;
}

/** HEL-1233 (widened by HEL-1260 to incomplete breakpoints): the signed-in owner of a stored-bad or
 * incomplete dashboard sends a one-time repair POST on open. Here the
 * stored-bad layout exists only in the response the browser receives (the server holds a valid one), so
 * the server correctly answers that POST with a no-op carrying ITS layout, and the client adopts it,
 * replacing the injected layout this suite exists to render. Stubbing the POST with a 409 (a documented
 * "layout changed, not applied" response the client logs and ignores) keeps the repair path inert so
 * what is asserted stays the HEL-1023 render-time repair of a layout the server never stored.
 * The owner repair itself is covered by the HEL-1233 jest, route and seam specs. */
async function stubOwnerRepair(page: Page) {
  const calls = { count: 0 };
  await page.route(
    (url) => /\/api\/dashboards\/[^/]+\/layout\/repair$/.test(url.pathname),
    async (route) => {
      calls.count++;
      await route.fulfill({
        status: 409,
        json: { message: "Dashboard layout changed; repair not applied" },
      });
    },
  );
  return calls;
}

// Request volume matters: the default backend rate-limits one user to 120 /api requests per 60s and a
// 429 on /api/auth/me logs the page out. So a state is loaded ONCE per theme and the window is then
// resized with setViewportSize (the grid re-measures and re-layouts live) instead of a goto per width.
const loaded = new WeakMap<Page, string>();
async function openAt(page: Page, dashboardId: string, width: number, theme: "light" | "dark") {
  await page.setViewportSize({ width, height: 1000 });
  const key = `${dashboardId}:${theme}`;
  if (loaded.get(page) === key) return;
  loaded.set(page, key);
  await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
  await page.goto(`/dashboards/${dashboardId}`);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

test.describe("HEL-1023 derive/repair the breakpoint layout at render", () => {
  test.setTimeout(240_000);

  let seeded: Seeded;
  let layouts: Record<string, Layout>;

  test.beforeEach(async ({ page, request }) => {
    await registerAndLogin(page, request);
    seeded = await seedDashboard(request);
    layouts = states(seeded.ids);
  });

  test.afterEach(async ({ request }) => {
    // Exact id only; panels cascade with their dashboard.
    // Retry on 429 so a rate-limited cleanup never leaks the dashboard.
    for (let attempt = 0; attempt < 6; attempt++) {
      const res = await request.delete(`/api/dashboards/${seeded.dashboardId}`, {
        headers: CSRF_HEADER,
      });
      if (res.status() !== 429) return;
      await new Promise((r) => setTimeout(r, 11_000));
    }
  });

  test.afterAll(() => {
    console.log(`[HEL-1023 e2e] throwaway users registered: ${JSON.stringify(seededUsers)}`);
  });

  // A and B are valid layouts (unauthored/partial breakpoints), so they are saved through the API.
  // C and D are STORED-BAD (out-of-bounds / overlapping): the server now rejects writing them
  // (HEL-1071), so they are injected at the HTTP boundary instead (see injectStoredLayout).
  const invalidStates = ["A_lg_only", "B_partial", "C_lg_coords_everywhere", "D_md_overlap"];
  const injectedStates = new Set(["C_lg_coords_everywhere", "D_md_overlap"]);

  for (const state of invalidStates) {
    test(`${state}: no overlap, inside the container, no PATCH on view, at every width`, async ({
      page,
      request,
    }) => {
      let injections: { count: number } | null = null;
      if (injectedStates.has(state)) {
        // Save a VALID lg through the API, then substitute the stored-bad layout in the dashboards
        // response the browser receives.
        const seed = await request.patch(`/api/dashboards/${seeded.dashboardId}/update`, {
          data: { fields: ["layout"], dashboard: { layout: { lg: layouts[state].lg } } },
          headers: CSRF_HEADER,
        });
        expect(seed.status()).toBe(200);
        // The intercept must bite: the injected layout is genuinely invalid at some breakpoint.
        expect(
          (Object.keys(COLS) as Bp[]).some((bp) => !isLayoutValid(layouts[state][bp], COLS[bp])),
          `${state} fixture must be stored-bad`,
        ).toBe(true);
        injections = await injectStoredLayout(page, seeded.dashboardId, layouts[state]);
        await stubOwnerRepair(page);
      } else {
        const patch = await request.patch(`/api/dashboards/${seeded.dashboardId}/update`, {
          data: { fields: ["layout"], dashboard: { layout: layouts[state] } },
          headers: CSRF_HEADER,
        });
        expect(patch.status()).toBe(200);
        // HEL-1260: A and B are valid but INCOMPLETE (empty / partial breakpoints), which the owner
        // repair now also writes on open; keep it inert so the render-time derivation is what is asserted.
        await stubOwnerRepair(page);
      }
      const layoutPatches: string[] = [];
      page.on("request", (r) => {
        if (r.method() === "PATCH" && r.url().includes(`/api/dashboards/${seeded.dashboardId}/`))
          layoutPatches.push(r.url());
      });
      for (const theme of ["light", "dark"] as const) {
        for (const win of windows) {
          await openAt(page, seeded.dashboardId, win.width, theme);
          const { rects, container } = await settledRects(page, 8, win.container);
          const label = `${state} ${theme} @${win.width} (${win.bp})`;
          expect(container, label).not.toBeNull();
          expect(Math.round(container!.w), `${label} container`).toBe(win.container);
          if (win.bp === "stack") {
            // Phone stack: one column, no horizontal page overflow, reading order of lg
            // (P1..P8) preserved by the derived xs.
            expect(
              rects.map((r) => r.title),
              label,
            ).toEqual(readingOrder);
            expect(
              await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
              label,
            ).toBe(true);
          } else {
            for (const r of rects) {
              expect(r.x, `${label} ${r.title} left`).toBeGreaterThanOrEqual(container!.x - 2);
              expect(r.x + r.w, `${label} ${r.title} right`).toBeLessThanOrEqual(
                container!.x + container!.w + 2,
              );
            }
            for (let a = 0; a < rects.length; a++)
              for (let b = a + 1; b < rects.length; b++)
                expect(
                  overlaps(rects[a], rects[b]),
                  `${label} ${rects[a].title}/${rects[b].title}`,
                ).toBe(false);
            // No dead vertical band: a derived/repaired layout is compacted, so consecutive rows
            // are separated by at most the grid margin, never a cascade-bumped hole.
            let bottom = Math.min(...rects.map((r) => r.y));
            for (const r of [...rects].sort((a, b) => a.y - b.y)) {
              expect(r.y - bottom, `${label} dead band above ${r.title}`).toBeLessThanOrEqual(40);
              bottom = Math.max(bottom, r.y + r.h);
            }
            // Reading order (y, then x) of the lg source is preserved when it is the source.
            if (state !== "D_md_overlap") {
              const order = [...rects]
                .sort((a, b) => Math.round(a.y) - Math.round(b.y) || a.x - b.x)
                .map((r) => r.title);
              expect(order, `${label} reading order`).toEqual(readingOrder);
            }
          }
          // Viewing (and resizing across breakpoints) never persists and never raises the dirty UI.
          await expect(page.getByText("Unsaved changes")).toHaveCount(0);
          await expect(page.getByRole("button", { name: "Save now" })).toHaveCount(0);
        }
      }
      expect(layoutPatches).toHaveLength(0);
      if (injections)
        expect(injections.count, `${state} injected layout was served`).toBeGreaterThan(0);
    });
  }

  test("V_valid_with_gaps: a valid authored layout renders exactly as saved at every breakpoint", async ({
    page,
    request,
  }) => {
    const layout = layouts.V_valid_with_gaps;
    const patch = await request.patch(`/api/dashboards/${seeded.dashboardId}/update`, {
      data: { fields: ["layout"], dashboard: { layout } },
      headers: CSRF_HEADER,
    });
    expect(patch.status()).toBe(200);
    const layoutPatches: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "PATCH" && r.url().includes(`/api/dashboards/${seeded.dashboardId}/`))
        layoutPatches.push(r.url());
    });
    const titleById = Object.fromEntries(
      Object.values(seeded.ids).map((id, i) => [id, titles[i]]),
    ) as Record<string, string>;
    for (const theme of ["light", "dark"] as const) {
      for (const win of windows.filter((w) => w.bp !== "stack")) {
        await openAt(page, seeded.dashboardId, win.width, theme);
        const { rects, container } = await settledRects(page, 8, win.container);
        const bp = win.bp as Bp;
        for (const item of layout[bp]) {
          const want = expectedRect(item, container!, COLS[bp]);
          const got = rects.find((r) => r.title === titleById[item.panelId])!;
          const label = `V ${theme} @${win.width} (${bp}) ${got.title}`;
          expect(Math.abs(got.x - want.x), `${label} x`).toBeLessThan(2);
          expect(Math.abs(got.y - want.y), `${label} y`).toBeLessThan(2);
          expect(Math.abs(got.w - want.w), `${label} w`).toBeLessThan(2);
          expect(Math.abs(got.h - want.h), `${label} h`).toBeLessThan(2);
        }
      }
    }
    expect(layoutPatches).toHaveLength(0);
  });
});
