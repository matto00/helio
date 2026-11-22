import {
  expect,
  request as apiRequest,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  attachApiRequestCounter,
  MAX_WINDOW_TARGET,
  type ApiRequestCounter,
} from "./support/apiRequestCounter";
import { registerAndLogin } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import {
  CSRF,
  LONG_STEPS,
  PANEL_TITLES,
  PIPELINE_COUNT,
  SHORT_STEPS,
  seed,
  type Seeded,
} from "./support/hel1585Seed";

// HEL-1585 -- the document never scrolls on an authenticated desktop route. At 1440x900 and 1280x800, on every route
// behind sign-in, `document.documentElement.scrollHeight` must not exceed `innerHeight` (the shell bounds itself and
// only inner regions scroll). One user per viewport test, seeded over HTTP (a 32-pipeline list, a long and a short
// step list, a dashboard with Output panels), then a client-side tour of every route, with soft collection and one
// final assertion naming every offending route. See openspec/changes/document-never-scrolls-guard/design.md.

const AUTH = { prefix: "hel1585", displayName: "HEL-1585", domain: "example.test" } as const;

/** Selectors that match a rendered error state (PageStatus's section error and EmptyState's error intent both carry
 *  role="alert"; the ErrorBoundary and the context list use plain text). Proven to match a real one by the third test. */
const ERROR_STATE = [
  ".app-content [role='alert']",
  ".context-list [role='alert']",
  ".ui-empty-state--error",
  ".ui-page-status--section-error",
  ".app-content :text-matches('Something went wrong|Couldn.t load|Failed to load', 'i')",
].join(", ");

interface RouteSpec {
  /** The AppRoutes pattern this entry covers. */
  pattern: string;
  /** A human label, also the step title. */
  label: string;
  /** The concrete path to visit. */
  path: (s: Seeded) => string;
  /** The sr-only heading's section label (every `AppShell` route has one). */
  heading: string | null;
}

const ROUTES: RouteSpec[] = [
  { pattern: "/home", label: "home", path: () => "/home", heading: "Home" },
  { pattern: "/dashboards", label: "dashboards", path: () => "/dashboards", heading: "Dashboards" },
  {
    pattern: "/dashboards/:id",
    label: "dashboard detail",
    path: (s) => `/dashboards/${s.dashboardId}`,
    heading: "Dashboards",
  },
  { pattern: "/sources", label: "sources", path: () => "/sources", heading: "Data Sources" },
  {
    pattern: "/sources/:id",
    label: "source detail",
    path: (s) => `/sources/${s.sourceId}`,
    heading: "Data Sources",
  },
  {
    pattern: "/pipelines",
    label: "pipelines",
    path: () => "/pipelines",
    heading: "Data Pipelines",
  },
  {
    pattern: "/pipelines/:id",
    label: "pipeline detail (long steps)",
    path: (s) => `/pipelines/${s.longId}`,
    heading: "Data Pipelines",
  },
  {
    pattern: "/pipelines/:id",
    label: "pipeline detail (short steps)",
    path: (s) => `/pipelines/${s.shortId}`,
    heading: "Data Pipelines",
  },
  { pattern: "/connectors", label: "connectors", path: () => "/connectors", heading: "Connectors" },
  { pattern: "/chat", label: "chat", path: () => "/chat", heading: "Assistant" },
  { pattern: "/settings", label: "settings", path: () => "/settings", heading: "Settings" },
  { pattern: "/admin/usage", label: "admin usage", path: () => "/admin/usage", heading: "Usage" },
  {
    pattern: "/proposals/review",
    label: "proposal review",
    path: () => "/proposals/review",
    heading: "Review Proposal",
  },
  {
    pattern: "/patch-sets/review",
    label: "patch-set review",
    path: () => "/patch-sets/review",
    heading: "Review Changes",
  },
  {
    pattern: "/pipeline-proposals/review",
    label: "pipeline-proposal review",
    path: () => "/pipeline-proposals/review",
    heading: "Review Pipeline Proposal",
  },
  {
    pattern: "/combined-proposals/review",
    label: "combined-proposal review",
    path: () => "/combined-proposals/review",
    heading: "Review Combined Proposal",
  },
  // Outside AppShell (a minimal consent card) but behind ProtectedRoute; with no ?request= it renders its early return.
  { pattern: "/connect/mcp", label: "connect mcp", path: () => "/connect/mcp", heading: null },
];

/** Every `path="..."` literal inside the ProtectedRoute block of AppRoutes.tsx. */
function protectedRoutePaths(): string[] {
  const src = readFileSync(resolve(__dirname, "../frontend/src/app/AppRoutes.tsx"), "utf8");
  const start = src.indexOf("<ProtectedRoute />");
  const end = src.indexOf('path="*"');
  expect(start, "AppRoutes.tsx: ProtectedRoute block start").toBeGreaterThan(-1);
  expect(end, "AppRoutes.tsx: fallback route").toBeGreaterThan(start);
  return [...src.slice(start, end).matchAll(/path="([^"]+)"/g)].map((m) => m[1]);
}

async function navigate(page: Page, path: string): Promise<void> {
  await page.evaluate((to) => {
    window.history.pushState({}, "", to);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
  await expect(page).toHaveURL(new RegExp(`${path.replace(/[/]/g, "\\/")}$`));
}

interface Measurement {
  route: string;
  path: string;
  scrollHeight: number;
  innerHeight: number;
  scrollY: number;
  tabBar: boolean;
  offender: string | null;
  note: string;
}

/** The deepest element, under the document, that is taller than the viewport (the culprit to name). */
async function tallestOverflower(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    let worst: { desc: string; h: number } | null = null;
    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      const taken = style.position === "absolute" || style.position === "fixed";
      if (!taken && !el.closest(".sr-only") && r.bottom > window.innerHeight + 1 && r.height > 0) {
        const h = r.bottom;
        if (worst === null || h >= worst.h) {
          worst = {
            desc: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}.${String((el as HTMLElement).className).replace(/\s+/g, ".")} bottom=${Math.round(r.bottom)}`,
            h,
          };
        }
      }
    }
    return worst?.desc ?? null;
  });
}

async function waitReady(page: Page, route: RouteSpec): Promise<string> {
  const notes: string[] = [];
  if (route.heading !== null) {
    await expect(
      page.locator("h1.app-content__sr-heading"),
      `${route.label}: heading`,
    ).toContainText(route.heading);
  }
  if (route.pattern === "/dashboards" || route.pattern === "/dashboards/:id") {
    const items = page.locator(".context-list li.dashboard-list__item--row");
    await expect
      .poll(() => items.count(), {
        message: `${route.label}: the Dashboards context list renders the seeded dashboards`,
      })
      .toBeGreaterThanOrEqual(30);
    notes.push(`context-list dashboards=${await items.count()}`);
  }
  if (route.pattern === "/dashboards/:id") {
    await expect(page.locator(".panel-grid-card"), `${route.label}: seeded panels`).toHaveCount(
      PANEL_TITLES.length,
    );
  }
  if (route.pattern === "/pipelines") {
    const rows = page.locator(".app-content a[href^='/pipelines/']");
    await expect
      .poll(() => rows.count(), { message: `${route.label}: page lists the seeded pipelines` })
      .toBeGreaterThanOrEqual(PIPELINE_COUNT);
    notes.push(`pipeline links=${await rows.count()}`);
  }
  if (route.pattern === "/pipelines/:id") {
    const want = route.label.includes("long") ? LONG_STEPS : SHORT_STEPS;
    await expect(page.locator(".spine-row"), `${route.label}: spine rows`).toHaveCount(want);
  }
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
  expect(
    await page.locator(ERROR_STATE).count(),
    `${route.label}: a visible error state is rendered`,
  ).toBe(0);
  return notes.join("; ");
}

async function longPipelineRegion(page: Page): Promise<string> {
  // The scroll region the spine's overflow lives in: the nearest scrollable ancestor of the spine rows.
  return page.evaluate(() => {
    const row = document.querySelector(".spine-row");
    let el: HTMLElement | null = row?.parentElement ?? null;
    while (el) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight) {
        return `${el.tagName.toLowerCase()}.${el.className.replace(/\s+/g, ".")} scrollHeight=${el.scrollHeight} clientHeight=${el.clientHeight}`;
      }
      el = el.parentElement;
    }
    return "none";
  });
}

async function runTour(
  request: APIRequestContext,
  page: Page,
  counter: ApiRequestCounter,
  width: number,
  height: number,
): Promise<void> {
  await registerAndLogin(page, request, { ...AUTH, label: `${width}` });
  // The seed goes through a cookie-less context authenticated by a personal access token: the rate limiter keys it
  // `pat:<tokenId>`, a different bucket from the browser session's `user:<id>` (RateLimitDirective), so the 40-odd
  // seed calls do not eat the tour's budget. Minting the token is the one counted call.
  const minted = await page.request.post("/api/tokens", {
    data: { name: "hel1585-seed" },
    headers: CSRF,
  });
  expect(minted.status(), "mint the seeding PAT").toBe(201);
  const { token } = (await minted.json()) as { token: string };
  const api = await apiRequest.newContext({
    baseURL: `http://localhost:${process.env.DEV_PORT ?? "5173"}`,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
  const s = await seed(api);
  await api.dispose();
  // The one counted reload: the already-booted app fetched its lists before the seed (HEL-1289/1300).
  await page.reload();
  await expect(page.locator("h1.app-content__sr-heading")).toContainText("Home");

  const measurements: Measurement[] = [];
  let wheel: Record<string, unknown> = {};
  for (const route of ROUTES) {
    await test.step(`${width}x${height} ${route.label}`, async () => {
      const path = route.path(s);
      await navigate(page, path);
      const note = await waitReady(page, route);
      let extra = note;
      if (route.pattern === "/pipelines/:id" && route.label.includes("long")) {
        const region = await longPipelineRegion(page);
        extra += `; inner region: ${region}`;
        // Soft, so a shell regression still reaches the document measurement below and names every route.
        expect
          .soft(region, `${route.label}: the spine content really overflows an inner region`)
          .not.toBe("none");
        if (width === 1440 && region !== "none") wheel = await wheelOverSpine(page);
      }
      const m = await page.evaluate(() => ({
        scrollHeight: document.documentElement.scrollHeight,
        innerHeight: window.innerHeight,
        scrollY: window.scrollY,
        tabBar: document.querySelector(".app-shell--tabs") !== null,
      }));
      const over = m.scrollHeight > m.innerHeight || m.scrollY !== 0;
      measurements.push({
        route: route.label,
        path,
        ...m,
        offender: over ? await tallestOverflower(page) : null,
        note: extra,
      });
    });
  }

  const report = counter.report();
  writeFileSync(
    evidencePath("HEL-1585", `measurements-${width}x${height}.json`),
    JSON.stringify(
      { width, height, seedRequests: s.seedRequests, report, wheel, measurements },
      null,
      2,
    ),
  );
  const offenders = measurements.filter((m) => m.scrollHeight > m.innerHeight || m.scrollY !== 0);
  expect(
    offenders.map(
      (m) =>
        `${m.route} (${m.path}): scrollHeight ${m.scrollHeight} > innerHeight ${m.innerHeight}, scrollY ${m.scrollY}, tallest: ${m.offender}`,
    ),
    `routes where the document scrolls at ${width}x${height}`,
  ).toEqual([]);
  if (width === 1440) {
    expect(wheel, "wheel check ran").toMatchObject({
      scrollY: 0,
      commandBarMoved: false,
      innerMoved: true,
    });
  }
}

async function wheelOverSpine(page: Page): Promise<Record<string, unknown>> {
  const row = page.locator(".spine-row").nth(2);
  await row.scrollIntoViewIfNeeded();
  const box = await row.boundingBox();
  expect(box, "spine row box").not.toBeNull();
  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height / 2;
  const barTop = () =>
    page.evaluate(
      () => document.querySelector(".app-command-bar")?.getBoundingClientRect().top ?? null,
    );
  const before = await barTop();
  await page.mouse.move(x, y);
  const scrollerOf = () =>
    page.evaluate(
      ([px, py]) => {
        let el: HTMLElement | null = document.elementFromPoint(px, py) as HTMLElement | null;
        while (el) {
          const oy = getComputedStyle(el).overflowY;
          if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight) {
            return {
              desc: `${el.tagName.toLowerCase()}.${el.className.replace(/\s+/g, ".")}`,
              top: el.scrollTop,
            };
          }
          el = el.parentElement;
        }
        return { desc: "none", top: 0 };
      },
      [x, y],
    );
  const scrollerBefore = await scrollerOf();
  await page.mouse.wheel(0, 600);
  await expect.poll(async () => (await scrollerOf()).top).toBeGreaterThan(scrollerBefore.top);
  const after = await scrollerOf();
  const result = {
    scrollY: await page.evaluate(() => window.scrollY),
    commandBarMoved: (await barTop()) !== before,
    innerMoved: after.top > scrollerBefore.top,
    innerRegion: after.desc,
    innerScrollTop: after.top,
  };
  return result;
}

for (const [width, height] of [
  [1440, 900],
  [1280, 800],
] as const) {
  test.describe(`HEL-1585 document never scrolls at ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });
    test.setTimeout(150_000);

    let counter: ApiRequestCounter;
    test.beforeEach(({ page }) => {
      counter = attachApiRequestCounter(page);
    });
    test.afterEach(async ({ page: _page }, info) => {
      const r = counter.report();
      console.log(`[HEL-1585 e2e] ${info.title}: ${counter.describe()}`);
      expect(r.count429, `rate-limited (429) responses: ${counter.describe()}`).toBe(0);
      expect(r.maxWindow, `worst 60s /api window: ${counter.describe()}`).toBeLessThanOrEqual(
        MAX_WINDOW_TARGET,
      );
    });

    test(`every authenticated route fits the viewport (${width}x${height})`, async ({
      page,
      request,
    }) => {
      await runTour(request, page, counter, width, height);
    });
  });
}

test.describe("HEL-1585 guard preconditions", () => {
  test("the route list covers every route inside ProtectedRoute", () => {
    const covered = new Set(ROUTES.map((r) => r.pattern));
    const found = protectedRoutePaths();
    expect(found.length, "AppRoutes.tsx path literals found").toBeGreaterThanOrEqual(15);
    expect(
      found.filter((p) => !covered.has(p)),
      "authenticated routes the guard's route list does not cover",
    ).toEqual([]);
  });

  test("the error-state selector matches a real rendered error state", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await registerAndLogin(page, request, { ...AUTH, label: "errprobe" });
    await page.route("**/api/data-sources*", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
    );
    await navigate(page, "/sources");
    await expect(page.locator(ERROR_STATE).first()).toBeVisible();
  });
});
