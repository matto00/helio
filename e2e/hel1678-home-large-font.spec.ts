import { writeFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";
import { evidencePath } from "./support/evidencePath";
import {
  framesWithRunsCard,
  holdRequests,
  installRecorder,
  recorded,
  seedHome,
  spread,
} from "./support/homeLoadProbe";

// HEL-1678 -- Home under a larger browser default font size (Chromium's "standard" font size, 24px instead of 16px):
// no horizontal scroll, and once the web fonts are loaded the run timeline does not move while the data loads.

test.describe.configure({ mode: "parallel" });
test.setTimeout(120_000);

const VIEWPORTS = [
  { width: 375, height: 812 },
  { width: 1280, height: 900 },
] as const;

async function setDefaultFontSize(page: Page, px: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Page.setFontSizes", { fontSizes: { standard: px, fixed: px } });
}

async function openingFontSize(page: Page): Promise<number> {
  return page.evaluate(() =>
    parseFloat(getComputedStyle(document.querySelector(".home-opening__sentence")!).fontSize),
  );
}

for (const theme of ["light", "dark"] as const) {
  for (const size of VIEWPORTS) {
    test(`Home at ${size.width}x${size.height} (${theme}) with a 24px default font size: no horizontal scroll, timeline does not move`, async ({
      page,
      request,
    }) => {
      await page.setViewportSize(size);
      await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
      await seedHome(page, request, `lf${size.width}${theme}`);

      // Red precondition: the default really changes the sentence's size here, so the later asserts are about a
      // larger-font Home and not a 16px one. Measured on a page loaded with the 16px default first.
      await page.goto("/home");
      await expect(page.locator(".home-opening__sentence")).toBeVisible();
      const base = await openingFontSize(page);

      await setDefaultFontSize(page, 24);
      await installRecorder(page);
      const gates = await holdRequests(page);
      await page.goto("/home", { waitUntil: "commit" });
      await expect.poll(() => framesWithRunsCard(page), { timeout: 30_000 }).toBeGreaterThan(8);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      await page.waitForTimeout(500);
      const start = (await recorded(page)).samples.length;
      gates.releaseDashboards();
      await page.waitForTimeout(400);
      gates.releaseSummary();
      const home = page.getByRole("region", { name: "Home" });
      await expect(home.locator(".home-shelf__item")).toHaveCount(4);
      await expect(home.locator('[aria-label="Pipeline runs, last 24 hours"]')).toBeVisible();
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      await page.waitForTimeout(600);

      const large = await openingFontSize(page);
      const { samples } = await recorded(page);
      const frames = samples.slice(start);
      const overflow = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        body: document.body.scrollWidth - document.body.clientWidth,
      }));
      const result = {
        theme,
        size,
        fontSizeDefault16: base,
        fontSizeDefault24: large,
        runsTopSpread: spread(frames.map((s) => s.runsTop)),
        overflow,
      };
      console.log(`HEL1678-LARGEFONT ${JSON.stringify(result)}`);
      writeFileSync(
        evidencePath("HEL-1678", `large-font-${size.width}x${size.height}-${theme}.json`),
        JSON.stringify(result, null, 2),
      );
      await page.screenshot({
        path: evidencePath("HEL-1678", `large-font-${size.width}x${size.height}-${theme}.png`),
      });

      expect(large, "the 24px default must enlarge the opening sentence").toBeGreaterThan(base);
      expect(overflow.doc, "no horizontal scroll on the document").toBeLessThanOrEqual(0);
      expect(overflow.body, "no horizontal scroll on the body").toBeLessThanOrEqual(0);
      expect(result.runsTopSpread, "runs card top after fonts loaded").toBeLessThanOrEqual(0.5);
    });
  }
}
