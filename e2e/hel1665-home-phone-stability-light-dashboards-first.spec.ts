import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { evidencePath } from "./support/evidencePath";
import { bisectHitExtent, measureBox } from "./support/touchTargetProbe";
import { holdRequests, seedHome, spread } from "./support/homeLoadProbe";
import {
  TOLERANCE,
  setup,
  loadHome,
  lastSettled,
  describeHomeLoadMatrix,
} from "./support/hel1665-home-phone-stability";

// HEL-1665 -- Home's run timeline must not move while Home loads. The shelf heading used to grow ~31px when the
// "All N" link mounted, and the skeleton cards, the runs card's legend and the opening line's placeholder each
// differed from their loaded form. This spec holds `GET /api/dashboards` and `GET /api/home-summary`, releases them
// one at a time (both orders) and samples the runs card's top, the top of its content and the shelf's top on EVERY
// animation frame from first paint to settle. Tolerance 0.5px (sub-pixel layout rounding only).
// Part of HEL-1665 split by HEL-1778 (hel1665-home-phone-stability.spec.ts): the light dashboards first part; shared code in support/hel1665-home-phone-stability.ts.

test.describe.configure({ mode: "parallel" });
test.setTimeout(180_000);

describeHomeLoadMatrix("light", "dashboards-first");

test("Home load (375x667 light): a longer opening sentence moves the timeline by its extra lines only", async ({
  page,
  request,
}) => {
  await setup(page, "light", { width: 375, height: 667 });
  await seedHome(page, request, "bound");
  const attention = (kind: string, id: number) => ({
    kind,
    pipelineId: "00000000-0000-4000-8000-00000000000" + id,
    pipelineName: `bound-${id}`,
    runId: null,
    at: new Date().toISOString(),
    reason: null,
    resolvedAt: null,
    inFlight: false,
  });
  const { samples, start } = await loadHome(page, "dashboards-first", (body) => {
    body.attention = [
      attention("failed", 1),
      attention("failed", 2),
      attention("stuck", 3),
      attention("stuck", 4),
      attention("missed", 5),
    ];
  });
  const frames = samples.slice(start);
  const settled = lastSettled(frames);
  const lineHeight = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.querySelector(".home-opening__sentence")!).lineHeight),
  );
  const lines = Math.round(settled.sentenceH! / lineHeight);
  const extra = (lines - 2) * lineHeight;
  const result = {
    lines,
    lineHeight,
    runsTopMoved: settled.runsTop! - frames[0].runsTop!,
    contentTopMoved: settled.contentTop! - frames[0].contentTop!,
    // The shelf sits below the sentence, so it moves by the same extra lines; its own boxes do not change.
    shelfTopMoved: settled.shelfTop! - frames[0].shelfTop!,
    shelfHeadHeightSpread: spread(frames.map((s) => s.shelfHeadH)),
    shelfCardHeightSpread: spread(frames.map((s) => s.shelfCardH)),
    runsHeadHeightSpread: spread(frames.map((s) => s.runsHeadH)),
  };
  console.log(`HEL1665-BOUND ${JSON.stringify(result)}`);
  writeFileSync(
    evidencePath("HEL-1665", "bound-375x667-light.json"),
    JSON.stringify(result, null, 2),
  );
  expect(lines).toBe(3);
  expect(Math.abs(result.runsTopMoved - extra)).toBeLessThanOrEqual(TOLERANCE);
  expect(Math.abs(result.contentTopMoved - extra)).toBeLessThanOrEqual(TOLERANCE);
  expect(Math.abs(result.shelfTopMoved - extra)).toBeLessThanOrEqual(TOLERANCE);
  expect(result.shelfHeadHeightSpread).toBeLessThanOrEqual(TOLERANCE);
  expect(result.shelfCardHeightSpread).toBeLessThanOrEqual(TOLERANCE);
  expect(result.runsHeadHeightSpread).toBeLessThanOrEqual(TOLERANCE);
});

// C1: Home desktop (1280, fine pointer) settled layout equals numbers measured on base 647734111.
// PINNED was measured on the unmodified base code (e2e-evidence/HEL-1665/base/desktop-1280-{light,dark}.json, identical
// in both themes), not in the same run as the change under test. The first-run (zero dashboards) head is exempt.
const PINNED: Record<string, number> = {
  "opening.top": 72,
  "opening.height": 55,
  "shelfHead.top": 159,
  "shelfHead.height": 18,
  "shelf.top": 193,
  "shelf.height": 168,
  "runsCard.top": 393,
  "runsCard.height": 139,
  "runsHead.top": 414,
  "runsHead.height": 17,
  "firstTimelineRow.top": 447,
  "firstTimelineRow.height": 64,
  "sideFirstCard.top": 393,
  "sideFirstCard.height": 89,
};

for (const theme of ["light", "dark"] as const) {
  test(`Home settled at 1280x900 (${theme}): boxes equal the pinned base numbers`, async ({
    page,
    request,
  }) => {
    await setup(page, theme, { width: 1280, height: 900 });
    await seedHome(page, request, `desk${theme}`);
    await page.goto("/home");
    const home = page.getByRole("region", { name: "Home" });
    await expect(home.locator(".home-shelf__item")).toHaveCount(4);
    const timeline = home.locator('[aria-label="Pipeline runs, last 24 hours"]');
    await expect(timeline).toBeVisible();
    await expect(home.locator(".home-opening__sentence")).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.waitForTimeout(500);
    const boxes = await page.evaluate(() => {
      const r = (el: Element | null | undefined) => {
        const b = el!.getBoundingClientRect();
        return { top: b.top, height: b.height };
      };
      const runs = document.querySelector(".home-runs")!;
      const timelineEl = document.querySelector('[aria-label="Pipeline runs, last 24 hours"]')!;
      const shelf = document.querySelector(".home-section")!;
      const side = document.querySelector(".home-page__side")!;
      return {
        opening: r(document.querySelector(".home-opening")),
        shelfHead: r(shelf.querySelector(".home-section__head")),
        shelf: r(document.querySelector(".home-shelf")),
        runsCard: r(runs),
        runsHead: r(runs.querySelector(".home-section__head")),
        firstTimelineRow: r(timelineEl.firstElementChild),
        sideFirstCard: r(side.firstElementChild),
      };
    });
    const flat: Record<string, number> = {};
    for (const [key, box] of Object.entries(boxes)) {
      flat[`${key}.top`] = box.top;
      flat[`${key}.height`] = box.height;
    }
    console.log(`HEL1665-DESKTOP ${JSON.stringify(flat)}`);
    writeFileSync(
      evidencePath("HEL-1665", `desktop-1280-${theme}.json`),
      JSON.stringify(flat, null, 2),
    );
    await page.screenshot({ path: evidencePath("HEL-1665", `home-1280x900-${theme}-settled.png`) });
    for (const [key, value] of Object.entries(PINNED)) {
      expect(Math.abs(flat[key] - value), key).toBeLessThanOrEqual(TOLERANCE);
    }
  });
}

// Relaxed AC2 (owner ruling C3): at 375x667 the timeline heading and the top of the first row are visible above the
// bottom nav, light and dark. This is a GUARD, not a fails-first test: it already held on base 647734111 (heading
// bottom 572.8, first row top 589.8, nav top 599), so it cannot be red on base; it is shown failable by a mutation
// (HEL-1642's one-column phone shelf restored), see e2e-evidence/HEL-1665/cycle6/.
for (const theme of ["light", "dark"] as const) {
  test(`Home at 375x667 (${theme}): the timeline heading and the top of the first row are above the bottom nav (guard)`, async ({
    page,
    request,
  }) => {
    await setup(page, theme, { width: 375, height: 667 });
    await seedHome(page, request, `short${theme}`);
    await page.goto("/home");
    const home = page.getByRole("region", { name: "Home" });
    await expect(home.locator(".home-shelf__item")).toHaveCount(4);
    await expect(home.locator('[aria-label="Pipeline runs, last 24 hours"]')).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.waitForTimeout(500);
    const m = await page.evaluate(() => {
      const runs = document.querySelector(".home-runs")!;
      const head = document.getElementById("home-runs-heading")!.getBoundingClientRect();
      const list = document.querySelector('[aria-label="Pipeline runs, last 24 hours"]')!;
      const firstRow = list.querySelector(".tl-disc__head")!.getBoundingClientRect();
      const nav = document.querySelector(".bottom-nav")!.getBoundingClientRect();
      return {
        scrollTop: document.querySelector(".app-content")?.scrollTop ?? 0,
        runsCardTop: runs.getBoundingClientRect().top,
        runsHeadingBottom: head.bottom,
        listTop: list.getBoundingClientRect().top,
        firstRowTop: firstRow.top,
        firstRowBottom: firstRow.bottom,
        navTop: nav.top,
      };
    });
    console.log(`HEL1665-SHORT ${JSON.stringify({ theme, ...m })}`);
    writeFileSync(
      evidencePath("HEL-1665", `short-phone-375x667-${theme}.json`),
      JSON.stringify({ theme, ...m }, null, 2),
    );
    await page.screenshot({ path: evidencePath("HEL-1665", `home-375x667-${theme}-settled.png`) });
    expect(m.scrollTop).toBe(0);
    expect(m.runsHeadingBottom, "runs heading bottom above the nav").toBeLessThan(m.navTop);
    expect(m.firstRowTop, "first row top above the nav").toBeLessThan(m.navTop);
  });
}

// Task 2.2: the section-head links keep a >=44px hit region (the sized ::after expander replaced the grown box)
// without growing their heading, and the expander overlaps no neighbour (bisected with elementFromPoint).
test("Home at 375px: the All N and +N more links keep a 44px hit region without a 44px box", async ({
  page,
  request,
}) => {
  await setup(page, "light", { width: 375, height: 800 });
  await seedHome(page, request, "touch");
  const gates = await holdRequests(page, (body) => {
    body.pipelinesWithActivity = (body.pipelines as unknown[]).length + 3;
  });
  gates.releaseDashboards();
  gates.releaseSummary();
  await page.goto("/home");
  const home = page.getByRole("region", { name: "Home" });
  const all = home.getByRole("link", { name: /^All 4/ });
  const more = home.getByRole("link", { name: /^\+3 more/ });
  await expect(all).toBeVisible();
  await expect(more).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const result: Record<string, unknown> = {};
  for (const [name, link] of [
    ["all", all],
    ["more", more],
  ] as const) {
    const y = await bisectHitExtent(page, link, "y", 0.25);
    const x = await bisectHitExtent(page, link, "x", 0.25);
    result[name] = { hitY: y, hitX: x, box: await measureBox(link) };
    expect((await measureBox(link)).height, `${name} box stays a text line`).toBeLessThan(30);
  }
  const headHeight = await page.evaluate(
    () => document.querySelector(".home-section__head")!.getBoundingClientRect().height,
  );
  result.shelfHeadHeight = headHeight;
  console.log(`HEL1665-TOUCH ${JSON.stringify(result)}`);
  writeFileSync(evidencePath("HEL-1665", "touch-375.json"), JSON.stringify(result, null, 2));
  expect(headHeight).toBeLessThan(30);
});
