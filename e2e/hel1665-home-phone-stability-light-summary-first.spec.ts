import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { evidencePath } from "./support/evidencePath";
import { seedHome } from "./support/homeLoadProbe";
import { setup, describeHomeLoadMatrix } from "./support/hel1665-home-phone-stability";

// HEL-1665 -- Home's run timeline must not move while Home loads. The shelf heading used to grow ~31px when the
// "All N" link mounted, and the skeleton cards, the runs card's legend and the opening line's placeholder each
// differed from their loaded form. This spec holds `GET /api/dashboards` and `GET /api/home-summary`, releases them
// one at a time (both orders) and samples the runs card's top, the top of its content and the shelf's top on EVERY
// animation frame from first paint to settle. Tolerance 0.5px (sub-pixel layout rounding only).
// Part of HEL-1665 split by HEL-1778 (hel1665-home-phone-stability.spec.ts): the light summary first part; shared code in support/hel1665-home-phone-stability.ts.

test.describe.configure({ mode: "parallel" });
test.setTimeout(180_000);

describeHomeLoadMatrix("light", "summary-first");

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
