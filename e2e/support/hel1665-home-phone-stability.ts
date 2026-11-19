import { writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { evidencePath } from "./evidencePath";
import {
  framesWithRunsCard,
  holdRequests,
  installRecorder,
  recorded,
  seedHome,
  spread,
  type Sample,
} from "./homeLoadProbe";

// Shared by the parts of the HEL-1665 spec (split by HEL-1778); moved verbatim from the original spec file.
export const TOLERANCE = 0.5;
export const VIEWPORTS = [
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

export type Order = "dashboards-first" | "summary-first";

export async function setup(
  page: Page,
  theme: "light" | "dark",
  size: { width: number; height: number },
) {
  await page.setViewportSize(size);
  await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
}

/** Runs the held load in the given order and returns the settled recording. */
export async function loadHome(
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

export function lastSettled(samples: Sample[]): Sample {
  return samples[samples.length - 1];
}

// The theme x viewport x order matrix of the original spec, registered once per part (C18).
export function describeHomeLoadMatrix(theme: "light" | "dark", order: Order) {
  for (const viewport of VIEWPORTS) {
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
        parseFloat(getComputedStyle(document.querySelector(".home-opening__sentence")!).lineHeight),
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
