import { writeFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";
import { evidencePath } from "./support/evidencePath";
import { assertTypeStyleActive, seedTypeStyle, type TypeStyle } from "./support/typeStyle";
import { bisectHitExtent, measureBox } from "./support/touchTargetProbe";
import {
  framesWithRunsCard,
  holdFonts,
  holdRequests,
  installRecorder,
  recorded,
  renderedFaces,
  seedHome,
  spread,
  type Sample,
} from "./support/homeLoadProbe";

// HEL-1665 -- Home's run timeline must not move while Home loads. The shelf heading used to grow ~31px when the
// "All N" link mounted, and the skeleton cards, the runs card's legend and the opening line's placeholder each
// differed from their loaded form. This spec holds `GET /api/dashboards` and `GET /api/home-summary`, releases them
// one at a time (both orders) and samples the runs card's top, the top of its content and the shelf's top on EVERY
// animation frame from first paint to settle. Tolerance 0.5px (sub-pixel layout rounding only).

test.describe.configure({ mode: "parallel" });
test.setTimeout(180_000);

const TOLERANCE = 0.5;
const VIEWPORTS = [
  { width: 375, height: 667, sentenceLines: 2 },
  { width: 375, height: 812, sentenceLines: 2 },
  { width: 430, height: 932, sentenceLines: 2 },
  // Inside the 431-604px band, still the phone shell, where the default sentence is two lines (HEL-1665 cycle 2).
  { width: 480, height: 900, sentenceLines: 2 },
  { width: 540, height: 900, sentenceLines: 2 },
  // HEL-1737: 605-613 is the band where the fallback-rendered default sentence is wider than the content box while the
  // web font's still fits, so the loading placeholder wrapped to two lines before the font arrived (30px).
  { width: 605, height: 900, sentenceLines: 1 },
  { width: 606, height: 900, sentenceLines: 1 },
  { width: 608, height: 900, sentenceLines: 1 },
  { width: 610, height: 900, sentenceLines: 1 },
  { width: 612, height: 900, sentenceLines: 1 },
  { width: 613, height: 900, sentenceLines: 1 },
  // 620 is just above the band; 1024 is a tablet-landscape desktop layout.
  { width: 620, height: 900, sentenceLines: 1 },
  { width: 1024, height: 900, sentenceLines: 1 },
  { width: 1280, height: 900, sentenceLines: 1 },
  // HEL-1737: 1440 is a wide desktop (already 0 on base while the placeholder is on screen: a guard).
  { width: 1440, height: 900, sentenceLines: 1 },
] as const;

type Order = "dashboards-first" | "summary-first";

async function setup(page: Page, theme: "light" | "dark", size: { width: number; height: number }) {
  await page.setViewportSize(size);
  await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
}

/** Runs the held load in the given order and returns the settled recording. */
async function loadHome(
  page: Page,
  order: Order,
  mutateSummary?: (body: Record<string, unknown>) => void,
) {
  await installRecorder(page);
  const gates = await holdRequests(page, mutateSummary);
  await page.goto("/home", { waitUntil: "commit" });
  await expect.poll(() => framesWithRunsCard(page), { timeout: 30_000 }).toBeGreaterThan(8);
  // A web-font swap is a separate, data-independent mover (reported as `fontSwapSpread`). `document.fonts.status`
  // can read "loaded" before any font load has started, so the data-load series starts at an index taken after
  // `fonts.ready`, a pause and ten consecutive identical frames, never from a status filter.
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(300);
  await expect
    .poll(async () => {
      const { samples } = await recorded(page);
      const tail = samples.slice(-10).map((s) => s.runsTop);
      return tail.length === 10 && new Set(tail).size === 1;
    })
    .toBe(true);
  const start = (await recorded(page)).samples.length;
  const first = order === "dashboards-first" ? gates.releaseDashboards : gates.releaseSummary;
  const second = order === "dashboards-first" ? gates.releaseSummary : gates.releaseDashboards;
  first();
  await page.waitForTimeout(600);
  second();
  const home = page.getByRole("region", { name: "Home" });
  await expect(home.locator(".home-shelf__item")).toHaveCount(4);
  await expect(home.locator(".home-opening__sentence")).toBeVisible();
  await expect(home.locator('[aria-label="Pipeline runs, last 24 hours"]')).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(600);
  return { ...(await recorded(page)), start };
}

function lastSettled(samples: Sample[]): Sample {
  return samples[samples.length - 1];
}

for (const theme of ["light", "dark"] as const) {
  for (const viewport of VIEWPORTS) {
    for (const order of ["dashboards-first", "summary-first"] as const) {
      const name = `${viewport.width}x${viewport.height} ${theme} ${order}`;
      test(`Home load (${name}): the timeline and the shelf do not move`, async ({
        page,
        request,
      }) => {
        await setup(page, theme, viewport);
        const label = `${viewport.width}${theme}${order === "summary-first" ? "s" : "d"}`;
        await seedHome(page, request, label);
        const { samples, shifts, start } = await loadHome(page, order);
        const allFrames = samples.filter((s) => s.runsTop !== null);
        const frames = samples.slice(start);
        const settled = lastSettled(frames);
        const lineHeight = await page.evaluate(() =>
          parseFloat(
            getComputedStyle(document.querySelector(".home-opening__sentence")!).lineHeight,
          ),
        );
        const sentenceLines = Math.round(settled.sentenceH! / lineHeight);
        const result = {
          viewport,
          theme,
          order,
          frames: frames.length,
          framesBeforeLoadSeries: start,
          fontSwapSpread: spread(samples.slice(0, start).map((s) => s.runsTop)),
          fontsAtFirstFrame: allFrames[0].fonts,
          fontsAtLastFrame: settled.fonts,
          settledSentenceLines: sentenceLines,
          runsTopSpread: spread(frames.map((s) => s.runsTop)),
          contentTopSpread: spread(frames.map((s) => s.contentTop)),
          shelfTopSpread: spread(frames.map((s) => s.shelfTop)),
          shelfHeadHeightSpread: spread(frames.map((s) => s.shelfHeadH)),
          shelfCardHeightSpread: spread(frames.map((s) => s.shelfCardH)),
          runsHeadHeightSpread: spread(frames.map((s) => s.runsHeadH)),
          openingHeightSpread: spread(frames.map((s) => s.openingH)),
          runsTopSettled: settled.runsTop,
          layoutShifts: shifts,
        };
        console.log(`HEL1665-SHIFT ${JSON.stringify(result)}`);
        writeFileSync(
          evidencePath(
            "HEL-1665",
            `shift-${viewport.width}x${viewport.height}-${theme}-${order}.json`,
          ),
          JSON.stringify(result, null, 2),
        );
        await page.screenshot({
          path: evidencePath(
            "HEL-1665",
            `home-${viewport.width}x${viewport.height}-${theme}-${order}.png`,
          ),
        });
        // Precondition: the settled sentence is the default one, with the default line count for this width.
        expect(sentenceLines).toBe(viewport.sentenceLines);
        expect(settled.link, "the settled shelf shows its All N link").toBe(true);
        expect(settled.legend, "the settled runs card shows its legend").toBe(true);
        // The cold-load web-font swap (`fontSwapSpread`): the metric-matched fallback faces (HEL-1678) keep it within
        // 4px at every width here (measured 0 on CI-like noble + Liberation and on a DejaVu-only noble; base was 8-24).
        // Already-cached fonts give 0, so this only fails on a real wide swap.
        // Red proof: base in a DejaVu-class fallback environment (8 at 375-540, 22-26 at 620+); on a Liberation-only host
        // base measures 3-4, so this assertion cannot go red there.
        expect(result.fontSwapSpread, "cold-load font swap").toBeLessThanOrEqual(4);
        expect(result.runsTopSpread, "runs card top").toBeLessThanOrEqual(TOLERANCE);
        expect(result.contentTopSpread, "runs card content start").toBeLessThanOrEqual(TOLERANCE);
        expect(result.shelfTopSpread, "shelf top").toBeLessThanOrEqual(TOLERANCE);
      });
    }
  }
}

// Bound: a loaded sentence longer than the default moves the timeline by the line difference only.
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

// Task 1.1b: the default sentence's line count per width (information, asserted at the three widths the fix uses).
for (const { width, lines } of [
  { width: 480, lines: 2 },
  { width: 604, lines: 2 },
  { width: 605, lines: 1 },
  { width: 375, lines: 2 },
  { width: 430, lines: 2 },
  { width: 768, lines: 1 },
  { width: 820, lines: 1 },
  { width: 1280, lines: 1 },
]) {
  test(`Home at ${width}px: the default opening sentence is ${lines} line(s)`, async ({
    page,
    request,
  }) => {
    await setup(page, "light", { width, height: 900 });
    await seedHome(page, request, `lines${width}`);
    await page.goto("/home");
    const sentence = page.locator(".home-opening__sentence");
    await expect(sentence).toHaveText("All quiet: nothing has changed, failed or been missed.");
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const m = await page.evaluate(() => {
      const el = document.querySelector(".home-opening__sentence")!;
      const style = getComputedStyle(el);
      return {
        height: el.getBoundingClientRect().height,
        lineHeight: parseFloat(style.lineHeight),
        fontsStatus: document.fonts.status,
      };
    });
    const count = Math.round(m.height / m.lineHeight);
    console.log(`HEL1665-LINES ${JSON.stringify({ width, count, ...m })}`);
    writeFileSync(
      evidencePath("HEL-1665", `sentence-lines-${width}.json`),
      JSON.stringify({ width, count, ...m }, null, 2),
    );
    expect(count).toBe(lines);
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

// HEL-1737: the REAL opening sentence keeps the web font's own 40ch width and line count at desktop (the cap is now a
// font-independent `em` measure equal to the web font's 40ch, so it no longer follows the rendered face). The
// precondition proves the web face rendered (CDP), because with a fallback `ch` would be a different width.
// Guard on base (green there: base's cap is literally 40ch); it fails if the em values drift from the web font's 40ch.
const MEASURE_CASES: { style: TypeStyle; web: string; lines: number }[] = [
  { style: "sans", web: "Schibsted Grotesk", lines: 2 },
  { style: "serif", web: "Fraunces", lines: 2 },
  { style: "mono", web: "JetBrains Mono", lines: 3 },
];
for (const theme of ["light", "dark"] as const) {
  for (const { style, web, lines } of MEASURE_CASES) {
    test(`Home settled at 1280x900 (${style} ${theme}): a long opening sentence keeps the web font's 40ch width and its line count`, async ({
      page,
      request,
    }) => {
      await setup(page, theme, { width: 1280, height: 900 });
      await seedHome(page, request, `long${style}${theme}`);
      await seedTypeStyle(page.request, style);
      const gates = await holdRequests(page, (body) => {
        const item = (kind: string, id: number) => ({
          kind,
          pipelineId: `00000000-0000-4000-8000-00000000000${id}`,
          pipelineName: `long-${id}`,
          runId: null,
          at: new Date().toISOString(),
          reason: null,
          resolvedAt: null,
          inFlight: false,
        });
        body.attention = [
          item("failed", 1),
          item("failed", 2),
          item("stuck", 3),
          item("missed", 4),
        ];
      });
      gates.releaseDashboards();
      gates.releaseSummary();
      await page.goto("/home");
      const sentence = page.locator(".home-opening__sentence");
      await expect(sentence).toContainText("everything else is quiet");
      await assertTypeStyleActive(page, style);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      // Precondition: the web face is what rendered (poll: the swap lands a moment after the data).
      await expect
        .poll(async () =>
          (await renderedFaces(page, ".home-opening__sentence")).map((f) => f.familyName),
        )
        .toContain(web);
      // ...and no font load is still in flight, so `40ch` is read from a settled font set.
      await expect.poll(() => page.evaluate(() => document.fonts.status)).toBe("loaded");
      const measure = () =>
        page.evaluate(() => {
          const el = document.querySelector<HTMLElement>(".home-opening__sentence")!;
          const style = getComputedStyle(el);
          const settledMax = parseFloat(style.maxWidth);
          const box = el.getBoundingClientRect();
          el.style.maxWidth = "40ch";
          const ch40 = parseFloat(getComputedStyle(el).maxWidth);
          el.style.maxWidth = "";
          return {
            text: el.textContent,
            settledMax,
            ch40,
            width: box.width,
            lines: Math.round(box.height / parseFloat(style.lineHeight)),
          };
        });
      const m = await measure();
      console.log(`HEL1665-LONG ${JSON.stringify({ style, ...m })}`);
      writeFileSync(
        evidencePath("HEL-1665", `long-sentence-1280-${style}-${theme}.json`),
        JSON.stringify({ style, ...m }, null, 2),
      );
      expect(Math.abs(m.settledMax - m.ch40), "cap equals the web font's 40ch").toBeLessThanOrEqual(
        0.5,
      );
      expect(m.lines).toBe(lines);
    });
  }
}

// HEL-1737: data BEFORE the web font. The runs timeline must not move when the web font replaces the fallback while
// the loaded sentence is already on screen (base: the sentence's `40ch` was narrower in the fallback, so it wrapped to
// two lines and reflowed to one, about 30px). The font requests are held until both APIs have settled and the loaded
// sentence has rendered in the fallback face (CDP proves which face), then released.
for (const theme of ["light", "dark"] as const) {
  for (const width of [1024, 1280, 1440] as const) {
    test(`Home data before the web font (${width}x900 ${theme}): the timeline does not move when the font arrives`, async ({
      page,
      request,
    }) => {
      await setup(page, theme, { width, height: 900 });
      await seedHome(page, request, `dbf${width}${theme}`);
      await installRecorder(page);
      const fonts = await holdFonts(page);
      const gates = await holdRequests(page);
      gates.releaseDashboards();
      gates.releaseSummary();
      await page.goto("/home", { waitUntil: "commit" });
      const home = page.getByRole("region", { name: "Home" });
      await expect(home.locator(".home-shelf__item")).toHaveCount(4);
      await expect(home.locator(".home-opening__sentence")).toHaveText(
        "All quiet: nothing has changed, failed or been missed.",
      );
      await expect(home.locator('[aria-label="Pipeline runs, last 24 hours"]')).toBeVisible();
      await expect.poll(() => fonts.held(), { timeout: 15_000 }).toBeGreaterThan(0);
      await page.waitForTimeout(500);
      const before = await renderedFaces(page, ".home-opening__sentence");
      const preSamples = (await recorded(page)).samples;
      const lineHeight = await page.evaluate(() =>
        parseFloat(getComputedStyle(document.querySelector(".home-opening__sentence")!).lineHeight),
      );
      const linesBefore = Math.round(preSamples[preSamples.length - 1].sentenceH! / lineHeight);
      const releaseIndex = preSamples.length - 1;
      await fonts.release();
      await expect
        .poll(
          async () =>
            (await renderedFaces(page, ".home-opening__sentence")).map((f) => f.familyName),
          {
            timeout: 30_000,
          },
        )
        .toContain("Schibsted Grotesk");
      await page.waitForTimeout(600);
      const after = await recorded(page);
      const frames = after.samples.slice(releaseIndex);
      const last = frames[frames.length - 1];
      const linesAfter = Math.round(last.sentenceH! / lineHeight);
      const result = {
        width,
        theme,
        facesBefore: before,
        linesBefore,
        linesAfter,
        runsTopSpread: spread(frames.map((s) => s.runsTop)),
        sentenceHeightSpread: spread(frames.map((s) => s.sentenceH)),
      };
      console.log(`HEL1737-DATAFIRST ${JSON.stringify(result)}`);
      writeFileSync(
        evidencePath("HEL-1737", `data-before-font-${width}-${theme}.json`),
        JSON.stringify(result, null, 2),
      );
      // Non-vacuity: the sentence really rendered in a fallback face before the release, and in the web face after.
      expect(
        before.some((f) => f.isCustomFont),
        "pre-swap face is a fallback",
      ).toBe(false);
      expect(linesAfter).toBe(1);
      expect(result.runsTopSpread, "runs card top across the font swap").toBeLessThanOrEqual(4);
    });
  }
}

// Type styles change the default sentence's wrap (Mono: two lines at 1280), so the hidden placeholder, which is the
// default sentence itself, must wrap like the real one under every style. Held load, fonts loaded, 0px series.
const STYLE_CASES: { style: TypeStyle; width: number; height: number }[] = [
  { style: "mono", width: 1280, height: 900 },
  { style: "mono", width: 375, height: 667 },
  { style: "serif", width: 1280, height: 900 },
  { style: "serif", width: 375, height: 667 },
];
for (const { style, width, height } of STYLE_CASES) {
  test(`Home load (${style} ${width}x${height} light dashboards-first): the timeline and the shelf do not move`, async ({
    page,
    request,
  }) => {
    await setup(page, "light", { width, height });
    await seedHome(page, request, `${style}${width}`);
    await seedTypeStyle(page.request, style);
    const { samples, start } = await loadHome(page, "dashboards-first");
    await assertTypeStyleActive(page, style);
    const frames = samples.slice(start);
    const settled = lastSettled(frames);
    const lineHeight = await page.evaluate(() =>
      parseFloat(getComputedStyle(document.querySelector(".home-opening__sentence")!).lineHeight),
    );
    const result = {
      style,
      width,
      height,
      settledSentenceLines: Math.round(settled.sentenceH! / lineHeight),
      runsTopSpread: spread(frames.map((s) => s.runsTop)),
      contentTopSpread: spread(frames.map((s) => s.contentTop)),
      shelfTopSpread: spread(frames.map((s) => s.shelfTop)),
      openingHeightSpread: spread(frames.map((s) => s.openingH)),
    };
    console.log(`HEL1665-STYLE ${JSON.stringify(result)}`);
    writeFileSync(
      evidencePath("HEL-1665", `style-${style}-${width}x${height}.json`),
      JSON.stringify(result, null, 2),
    );
    expect(result.runsTopSpread, "runs card top").toBeLessThanOrEqual(TOLERANCE);
    expect(result.contentTopSpread, "runs card content start").toBeLessThanOrEqual(TOLERANCE);
    expect(result.shelfTopSpread, "shelf top").toBeLessThanOrEqual(TOLERANCE);
  });
}
