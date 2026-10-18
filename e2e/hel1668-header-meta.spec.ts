import { expect, test } from "@playwright/test";

import { registerAndLogin } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import { AUTH, THEMES, openPipeline, seedPipeline } from "./support/hel1582Phone";
import { stubLastRun } from "./support/hel1668";

// HEL-1668 (final gate CR1): the header's last-run line never shows a CUT figure. The relative time is always fully
// visible; the "N rows written ·" part is either absent or the whole formatted figure with its words, never a 1-2
// character fragment ("1…", "1 3 minutes ago").

const CASES = [
  { width: 1000, height: 800, phone: false },
  { width: 1024, height: 800, phone: false },
  { width: 375, height: 812, phone: true },
] as const;

for (const c of CASES) {
  for (const rows of [14, 12_345_678]) {
    test(`last-run meta never shows a cut figure: ${rows.toLocaleString("en-US")} rows at ${c.width}x${c.height}`, async ({
      page,
      request,
    }) => {
      test.setTimeout(150_000);
      await registerAndLogin(page, request, { ...AUTH, label: `meta-${c.width}-${rows}` });
      const pipelineId = await seedPipeline(page, false, false, true);
      await stubLastRun(page, rows);
      await page.setViewportSize({ width: c.width, height: c.height });
      for (const theme of THEMES) {
        await openPipeline(page, pipelineId, theme);
        const meta = page.getByLabel("Last run metadata");
        await expect(meta).toBeVisible();
        const m = await meta.evaluate((el) => {
          const box = el.querySelector(".spine-header__meta-text") as HTMLElement;
          const b = box.getBoundingClientRect();
          const inside = (r: DOMRect) =>
            r.left >= b.left - 0.5 &&
            r.right <= b.right + 0.5 &&
            r.top >= b.top - 0.5 &&
            r.bottom <= b.bottom + 0.5;
          const intersects = (r: DOMRect) =>
            r.right > b.left && r.left < b.right && r.bottom > b.top && r.top < b.bottom;
          const count = el.querySelector(".spine-header__meta-count") as HTMLElement | null;
          const time = el.querySelector(".spine-header__meta-time") as HTMLElement;
          const cr = count?.getBoundingClientRect();
          return {
            time: { text: time.textContent, inside: inside(time.getBoundingClientRect()) },
            count:
              count && cr
                ? {
                    text: count.textContent,
                    visible: intersects(cr),
                    inside: inside(cr),
                    ellipsized: count.scrollWidth > count.clientWidth + 0.5,
                  }
                : null,
          };
        });
        console.log("META", c.width, rows, theme, JSON.stringify(m));
        expect(m.time.inside, "the relative time is fully visible").toBe(true);
        if (m.count?.visible) {
          const whole = `${rows.toLocaleString("en-US")} rows written ·`;
          expect(m.count.text, "a visible count part is the whole formatted figure").toBe(whole);
          expect(m.count.inside, "and is not clipped").toBe(true);
          expect(m.count.ellipsized, "nor ellipsized").toBe(false);
        }
        await page.screenshot({
          path: evidencePath("HEL-1668", `meta-${c.width}-${rows}-${theme}.png`),
        });
      }
    });
  }
}

// Final-gate round 2: a hidden count must hand its width back to the header (no reserved empty gap, the pipeline name is
// not truncated while it would fit), and the count must still show when there is genuinely room.
for (const width of [1280, 1440]) {
  test(`hidden count reserves no width; count shows when there is room (${width}x800)`, async ({
    page,
    request,
  }) => {
    test.setTimeout(150_000);
    await registerAndLogin(page, request, { ...AUTH, label: `meta-gap-${width}` });
    const pipelineId = await seedPipeline(page, false, false, true);
    const renamed = await page.request.patch(`/api/pipelines/${pipelineId}`, {
      data: { name: "hel1668-long-pipeline-name" },
      headers: { "X-Helio-Requested-With": "1" },
    });
    expect(renamed.status()).toBeLessThan(300);
    await stubLastRun(page, 14);
    await page.setViewportSize({ width, height: 800 });
    for (const theme of THEMES) {
      await openPipeline(page, pipelineId, theme);
      const meta = page.getByLabel("Last run metadata");
      await expect(meta).toBeVisible();
      const m = await meta.evaluate((el) => {
        const box = el.querySelector(".spine-header__meta-text") as HTMLElement;
        const b = box.getBoundingClientRect();
        const count = el.querySelector(".spine-header__meta-count") as HTMLElement;
        const cr = count.getBoundingClientRect();
        const time = el.querySelector(".spine-header__meta-time") as HTMLElement;
        const name = document.querySelector(".spine-header__name") as HTMLElement;
        const trailing = document.querySelector(".spine-header__trailing") as HTMLElement;
        return {
          countVisible:
            cr.bottom > b.top && cr.top < b.bottom && cr.right > b.left && cr.left < b.right,
          nameTruncated: name.scrollWidth > name.clientWidth + 0.5,
          nameText: name.textContent,
          timeRight: time.getBoundingClientRect().right,
          boxRight: b.right,
          trailingLeft: trailing.getBoundingClientRect().left,
        };
      });
      console.log("GAP", width, theme, JSON.stringify(m));
      expect(m.nameTruncated, "the pipeline name is not truncated").toBe(false);
      if (width === 1440) expect(m.countVisible, "the count shows when there is room").toBe(true);
      await page.screenshot({ path: evidencePath("HEL-1668", `meta-gap-${width}-${theme}.png`) });
    }
  });
}
