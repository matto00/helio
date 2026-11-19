import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { evidencePath } from "./support/evidencePath";
import { assertTypeStyleActive, seedTypeStyle, type TypeStyle } from "./support/typeStyle";
import { holdRequests, renderedFaces, seedHome, spread } from "./support/homeLoadProbe";
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
// Part of HEL-1665 split by HEL-1778 (hel1665-home-phone-stability.spec.ts): the dark dashboards first part; shared code in support/hel1665-home-phone-stability.ts.

test.describe.configure({ mode: "parallel" });
test.setTimeout(180_000);

describeHomeLoadMatrix("dark", "dashboards-first");

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
