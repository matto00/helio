import { writeFileSync } from "node:fs";

import { expect, test, type APIRequestContext } from "@playwright/test";
import { CSRF_HEADER, currentUserId, registerAndLogin } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import { seedPipelineRuns } from "./support/homeSeed";

// HEL-1642 -- on a phone Home's dashboard shelf stays two columns (2 rows x 2 cards) so the 24h run timeline's top
// lands above the floating bottom nav on first load. Pins that at 375 and 430 (height 800) in both themes, plus
// no horizontal scroll on BOTH the document and the `.app-content` scroller (constraint C1). A 375x667 measurement
// is recorded for information only (a short phone), never asserted.

test.describe.configure({ mode: "parallel" });
test.setTimeout(120_000);

const AUTH = { prefix: "hel1642h", displayName: "HEL-1642 Home", domain: "example.com" } as const;

async function post<T>(request: APIRequestContext, url: string, data: unknown): Promise<T> {
  const res = await request.post(url, { data, headers: { [CSRF_HEADER]: "1" } });
  expect(res.status(), `${url}: ${await res.text()}`).toBe(201);
  return (await res.json()) as T;
}

const CASES: { width: number; height: number; asserted: boolean }[] = [
  { width: 375, height: 800, asserted: true },
  { width: 430, height: 800, asserted: true },
  { width: 375, height: 667, asserted: false },
];

for (const theme of ["light", "dark"] as const) {
  for (const { width, height, asserted } of CASES) {
    test(`Home at ${width}x${height} (${theme}): timeline starts above the bottom nav${asserted ? "" : " (info only)"}`, async ({
      page,
      request,
    }) => {
      await page.setViewportSize({ width, height });
      await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
      await registerAndLogin(page, request, {
        ...AUTH,
        label: `${width}x${height}${theme}`,
        isolate: true,
      });
      const userId = await currentUserId(request);
      for (const name of ["Ops", "Sales", "Growth", "Support"]) {
        await post(request, "/api/dashboards", { name: `HEL-1642 ${name}` });
      }
      const source = await post<{ id: string }>(request, "/api/data-sources", {
        name: "HEL-1642 Home Source",
        type: "static",
        columns: [{ name: "note", type: "string", required: true }],
        rows: [["seed"]],
      });
      const pipeline = await post<{ id: string }>(request, "/api/pipelines", {
        name: "hel1642-orders-sync",
        roots: [{ sourceId: source.id }],
      });
      await post(request, `/api/pipelines/${pipeline.id}/outputs`, {
        kind: "table",
        name: "T",
        config: {},
      });
      seedPipelineRuns(pipeline.id, userId, [
        { status: "succeeded", hoursAgo: 8 },
        { status: "succeeded", hoursAgo: 5 },
        { status: "failed", hoursAgo: 3, errorLog: "source returned 0 rows" },
      ]);

      await page.goto("/home");
      const home = page.getByRole("region", { name: "Home" });
      const timeline = home.locator('[aria-label="Pipeline runs, last 24 hours"]');
      await expect(timeline).toBeVisible();
      await expect(home.locator(".home-shelf__item")).toHaveCount(4);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));

      const m = await page.evaluate(() => {
        const scroller = document.querySelector<HTMLElement>(".app-content");
        const nav = document.querySelector(".bottom-nav");
        const tl = document.querySelector('[aria-label="Pipeline runs, last 24 hours"]')!;
        const cards = Array.from(document.querySelectorAll(".home-shelf__item"));
        const rowTops = Array.from(
          new Set(cards.map((c) => Math.round(c.getBoundingClientRect().top))),
        );
        return {
          viewportHeight: window.innerHeight,
          scrollTop: scroller?.scrollTop ?? 0,
          timelineTop: tl.getBoundingClientRect().top,
          navTop: nav ? nav.getBoundingClientRect().top : null,
          cardCount: cards.length,
          rowTops,
          cardsPerRow: rowTops.map(
            (t) => cards.filter((c) => Math.round(c.getBoundingClientRect().top) === t).length,
          ),
          docScrollWidth: document.documentElement.scrollWidth,
          docClientWidth: document.documentElement.clientWidth,
          contentScrollWidth: scroller?.scrollWidth ?? null,
          contentClientWidth: scroller?.clientWidth ?? null,
        };
      });
      const out = { width, height, theme, ...m };
      console.log(`HEL1642-HOME ${JSON.stringify(out)}`);
      writeFileSync(
        evidencePath("HEL-1642", `home-${width}x${height}-${theme}.json`),
        JSON.stringify(out, null, 2),
      );
      await page.screenshot({
        path: evidencePath("HEL-1642", `home-${width}x${height}-${theme}-viewport.png`),
      });
      if (!asserted) return;

      expect(m.scrollTop).toBe(0);
      expect(m.navTop, "bottom nav must be present").not.toBeNull();
      expect(m.timelineTop).toBeLessThan(m.navTop!);
      expect(m.cardCount).toBe(4);
      expect(m.cardsPerRow).toEqual([2, 2]);
      // C1: no horizontal scroll on the document nor on the .app-content scroller.
      expect(m.docScrollWidth).toBeLessThanOrEqual(m.docClientWidth);
      expect(m.contentScrollWidth).not.toBeNull();
      expect(m.contentScrollWidth!).toBeLessThanOrEqual(m.contentClientWidth!);
    });
  }
}

// Task 3.2 regression evidence: the shelf elsewhere keeps its column count (4 at 1280, 2 at 820).
for (const theme of ["light", "dark"] as const) {
  for (const { width, columns } of [
    { width: 1280, columns: 4 },
    { width: 820, columns: 2 },
  ]) {
    test(`Home at ${width}px (${theme}): shelf keeps ${columns} columns`, async ({
      page,
      request,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
      await registerAndLogin(page, request, {
        ...AUTH,
        label: `wide${width}${theme}`,
        isolate: true,
      });
      for (const name of ["Ops", "Sales", "Growth", "Support"]) {
        await post(request, "/api/dashboards", { name: `HEL-1642 ${name}` });
      }
      await page.goto("/home");
      const items = page.getByRole("region", { name: "Home" }).locator(".home-shelf__item");
      await expect(items).toHaveCount(4);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const perRow = await page.evaluate(() => {
        const tops = Array.from(document.querySelectorAll(".home-shelf__item")).map((c) =>
          Math.round(c.getBoundingClientRect().top),
        );
        return tops.filter((t) => t === tops[0]).length;
      });
      await page.screenshot({
        path: evidencePath("HEL-1642", `home-${width}-${theme}-viewport.png`),
      });
      expect(perRow).toBe(columns);
    });
  }
}
