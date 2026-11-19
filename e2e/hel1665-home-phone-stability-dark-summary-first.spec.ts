import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { evidencePath } from "./support/evidencePath";
import {
  holdFonts,
  holdRequests,
  installRecorder,
  recorded,
  renderedFaces,
  seedHome,
  spread,
} from "./support/homeLoadProbe";
import { setup, describeHomeLoadMatrix } from "./support/hel1665-home-phone-stability";

// HEL-1665 -- Home's run timeline must not move while Home loads. The shelf heading used to grow ~31px when the
// "All N" link mounted, and the skeleton cards, the runs card's legend and the opening line's placeholder each
// differed from their loaded form. This spec holds `GET /api/dashboards` and `GET /api/home-summary`, releases them
// one at a time (both orders) and samples the runs card's top, the top of its content and the shelf's top on EVERY
// animation frame from first paint to settle. Tolerance 0.5px (sub-pixel layout rounding only).
// Part of HEL-1665 split by HEL-1778 (hel1665-home-phone-stability.spec.ts): the dark summary first part; shared code in support/hel1665-home-phone-stability.ts.

test.describe.configure({ mode: "parallel" });
test.setTimeout(180_000);

describeHomeLoadMatrix("dark", "summary-first");

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
