import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { registerAndLogin } from "./support/auth";

// HEL-1608: in compact spine rows (narrow desktop pages) the row count shares the summary line. A long count
// ("12,345") must take its own width and never overprint the summary. The HEL-1579 sweep seeds only 14 rows, so
// this spec seeds a source large enough for a 6-character count, with its own seeding.

const CSRF = { "X-Helio-Requested-With": "1" };
const ROWS = 12_345;

async function seedBigPipeline(page: Page, request: APIRequestContext): Promise<string> {
  await registerAndLogin(page, request, {
    prefix: "hel1608cnt",
    displayName: "HEL-1608",
    domain: "example.test",
    label: "count",
  });
  const post = async <T>(url: string, data: unknown): Promise<T> => {
    const res = await page.request.post(url, { data, headers: CSRF });
    expect(res.status(), `${url} ${await res.text()}`).toBeLessThan(300);
    return (await res.json()) as T;
  };
  const csv =
    "n,label\n" + Array.from({ length: ROWS }, (_, i) => `${i},row-${i}`).join("\n") + "\n";
  const res = await page.request.post("/api/data-sources", {
    multipart: {
      name: "hel1608-big-src",
      file: { name: "big.csv", mimeType: "text/csv", buffer: Buffer.from(csv) },
    },
    headers: CSRF,
  });
  expect(res.status(), await res.text()).toBeLessThan(300);
  const source = (await res.json()) as { id: string };
  const pipeline = await post<{ id: string }>("/api/pipelines", {
    name: "hel1608-big-pipe",
    roots: [{ sourceId: source.id }],
  });
  const step = (type: string, config: unknown, extra: object = {}) =>
    post<{ id: string }>(`/api/pipelines/${pipeline.id}/steps`, { type, config, ...extra });
  await step("sort", { sortBy: [{ field: "label", direction: "asc" }] });
  const sort = await step("sort", { sortBy: [{ field: "n", direction: "desc" }] });
  await step(
    "sort",
    { sortBy: [{ field: "label", direction: "desc" }] },
    { parentStepId: sort.id, attachAsTail: true },
  );
  // A trunk step whose title ("Compute column") is truncated at compact widths: the selected-row menu must not
  // cover a title that fills line one.
  await step("compute", { column: "m", expression: "n / 60", type: "float" });
  // An Output card too (HEL-1671: its menu follows the same rule).
  await post(`/api/pipelines/${pipeline.id}/outputs`, {
    kind: "table",
    name: "hel1608_out",
    config: {},
    nodeStepId: sort.id,
  });
  await post(`/api/pipelines/${pipeline.id}/run`, {});
  return pipeline.id;
}

async function openPipeline(page: Page, pipelineId: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/pipelines/${pipelineId}`);
  await expect(page.locator(".spine-row__count", { hasText: "12,345" }).first()).toBeVisible({
    timeout: 60_000,
  });
  await page.evaluate(() => document.fonts.ready);
}

async function setListWidth(page: Page, listWidth: "default" | "max"): Promise<void> {
  if (listWidth === "max") {
    await page.getByRole("separator").first().focus();
    await page.keyboard.press("End");
  }
}

/** Parks the pointer away from the spine and drops focus, so only the state under test reveals anything. */
async function settle(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await page.mouse.move(0, 0);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(350);
}

/** The spine column's own content box, which is what the compact container query measures (compact iff <= 226). */
async function spineMode(page: Page): Promise<{ box: number; compact: boolean }> {
  return page.evaluate(() => {
    const sp = document.querySelector<HTMLElement>(".spine-body__spine")!;
    const cs = getComputedStyle(sp);
    const box = sp.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return { box, compact: box <= 226 };
  });
}

test("compact spine rows: a 6-character row count never overlaps the summary", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const pipelineId = await seedBigPipeline(page, request);
  await openPipeline(page, pipelineId);

  for (const listWidth of ["default", "max"] as const) {
    await setListWidth(page, listWidth);
    for (const width of [769, 809, 849, 889, 929, 969, 1009, 1100]) {
      await page.setViewportSize({ width, height: 900 });
      await page.mouse.move(0, 0);
      const rows = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>(".spine-body__spine .spine-row")).map(
          (row) => {
            const rect = (sel: string) =>
              row.querySelector<HTMLElement>(sel)!.getBoundingClientRect();
            const c = rect(".spine-row__count");
            const s = rect(".spine-row__summary");
            const sel = rect(".spine-row__select");
            return {
              label: row.querySelector(".spine-row__title")!.textContent,
              count: row.querySelector(".spine-row__count")!.textContent,
              overlap: Math.min(c.right, s.right) - Math.max(c.left, s.left),
              sameLine: c.top < s.bottom && c.bottom > s.top,
              countInside: c.left >= sel.left - 0.5 && c.right <= sel.right + 0.5,
              summaryW: s.width,
            };
          },
        ),
      );
      expect(rows.length).toBeGreaterThanOrEqual(3);
      for (const r of rows) {
        const at = `${width}px list=${listWidth} "${r.label}" count "${r.count}"`;
        expect(r.count!.length, `${at}: the long count is shown`).toBeGreaterThanOrEqual(5);
        expect(
          r.sameLine && r.overlap > 0,
          `${at}: count overlaps the summary by ${Math.round(r.overlap)}px`,
        ).toBe(false);
        expect(r.countInside, `${at}: count stays inside the row`).toBe(true);
      }
    }
  }
});

const WIDTHS = [769, 900, 1009, 1024, 1100];
const COMPACT_ON_AT_DEFAULT = [769, 809, 849, 889, 929, 969, 1009];

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

// HEL-1671 item 3: compact mode is actually ON at 769-1009px and OFF at 1100px (list default), and elsewhere it
// follows the spine's own content box. This is a GUARD on existing behaviour (it passes on main); its mutation
// (the 226px threshold lowered) is recorded in the change's evidence.
test("compact mode is on at 769-1009px and off at 1100px (list default); elsewhere it follows the column", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const pipelineId = await seedBigPipeline(page, request);
  await openPipeline(page, pipelineId);
  for (const listWidth of ["default", "max"] as const) {
    await setListWidth(page, listWidth);
    for (const width of [...COMPACT_ON_AT_DEFAULT, 1024, 1100]) {
      await settle(page, width);
      const mode = await spineMode(page);
      const rows = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>(".spine-body__spine .spine-row")).map(
          (row) => {
            const title = row
              .querySelector<HTMLElement>(".spine-row__title")!
              .getBoundingClientRect();
            const count = row
              .querySelector<HTMLElement>(".spine-row__count")!
              .getBoundingClientRect();
            return {
              display: getComputedStyle(row.querySelector(".spine-row__select")!).display,
              countBelowTitle: count.top >= title.bottom - 0.5,
            };
          },
        ),
      );
      const at = `${width}px list=${listWidth} (content box ${mode.box}px)`;
      if (listWidth === "default" && width <= 1009) {
        expect(mode.compact, `${at}: the ticket says compact is on here`).toBe(true);
      }
      if (listWidth === "default" && width === 1100) {
        expect(mode.compact, `${at}: the ticket says compact is off here`).toBe(false);
      }
      for (const r of rows) {
        expect(r.display, `${at}: select display`).toBe(mode.compact ? "grid" : "flex");
        if (mode.compact) expect(r.countBelowTitle, `${at}: count on the summary line`).toBe(true);
      }
    }
  }
});

/** Geometry of the selected row's menu trigger against the row's own title, summary and count (runs in the page). */
const triggerGeometry = (row: HTMLElement) => {
  const intersects = (a: Box, b: Box): boolean =>
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const box = (el: Element): Box => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  };
  const trigger = row.querySelector<HTMLElement>(".spine-row__menu button")!;
  const t = box(trigger);
  const hit = document.elementFromPoint((t.left + t.right) / 2, (t.top + t.bottom) / 2);
  const title = row.querySelector<HTMLElement>(".spine-row__title")!;
  const range = document.createRange();
  range.selectNodeContents(title);
  const text = range.getBoundingClientRect();
  const tb = box(title);
  const visible: Box = {
    left: Math.max(text.left, tb.left),
    right: Math.min(text.right, tb.right),
    top: tb.top,
    bottom: tb.bottom,
  };
  // Sample the visible title text, including its bottom band, for the trigger covering it.
  let covered = 0;
  for (const fx of [0.05, 0.5, 0.95]) {
    for (const y of [visible.top + 1, (visible.top + visible.bottom) / 2, visible.bottom - 1]) {
      const x = visible.left + (visible.right - visible.left) * fx;
      if (document.elementFromPoint(x, y)?.closest(".spine-row__menu")) covered += 1;
    }
  }
  const select = row.querySelector<HTMLElement>(".spine-row__select")!;
  const gap = parseFloat(getComputedStyle(select).columnGap) || 0;
  const summary = box(row.querySelector(".spine-row__summary")!);
  const count = box(row.querySelector(".spine-row__count")!);
  return {
    hitInMenu: !!hit?.closest(".spine-row__menu"),
    titleBoxHit: intersects(t, tb),
    overCount: intersects(t, count),
    overSummary: intersects(t, summary),
    covered,
    gap,
    between: count.left - summary.right,
  };
};

// HEL-1671 items 1, 2 and 4 (D5.2, D5.3, D5.3b): one rule for the spine's three-dot menu, at every desktop width.
test("spine row menu: one rule (cards and the selected row always show it, unselected rows on hover/focus); empty markers take no space", async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  const pipelineId = await seedBigPipeline(page, request);
  await openPipeline(page, pipelineId);
  const rows = page.locator(".spine-body__spine .spine-row");
  const opacityOf = (i: number) =>
    rows.nth(i).evaluate((row) => getComputedStyle(row.querySelector(".spine-row__menu")!).opacity);

  for (const listWidth of ["default", "max"] as const) {
    await setListWidth(page, listWidth);
    for (const width of WIDTHS) {
      await settle(page, width);
      const mode = await spineMode(page);
      const at = `${width}px list=${listWidth} compact=${mode.compact}`;
      // Cards: always visible.
      const cards = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>(".spine-card__menu")).map(
          (m) => getComputedStyle(m).opacity,
        ),
      );
      expect.soft(cards.length, `${at}: cards render a menu`).toBeGreaterThanOrEqual(2);
      for (const o of cards) expect.soft(o, `${at}: card menu opacity`).toBe("1");

      // Select row 1 (the middle one); row 0 stays unselected.
      await rows.nth(1).locator(".spine-row__select").click();
      await settle(page, width);
      await expect
        .soft(rows.nth(1).locator(".spine-row__select"))
        .toHaveAttribute("aria-current", "true");
      expect.soft(await opacityOf(1), `${at}: the selected row's menu is always visible`).toBe("1");
      expect
        .soft(await opacityOf(0), `${at}: an unselected row's menu is hidden until hover/focus`)
        .toBe("0");

      const geo = await rows.nth(1).evaluate(triggerGeometry);
      expect.soft(geo.hitInMenu, `${at}: the selected trigger is hit-testable`).toBe(true);
      if (mode.compact) {
        expect.soft(geo.overCount, `${at}: trigger does not cover the count`).toBe(false);
        expect.soft(geo.overSummary, `${at}: trigger does not cover the summary`).toBe(false);
        expect.soft(geo.covered, `${at}: trigger does not cover the visible title text`).toBe(0);
        // Item 2: no markers, so the summary-to-count gap is exactly one column gap, not two.
        expect
          .soft(
            Math.abs(geo.between - geo.gap),
            `${at}: summary-to-count gap ${geo.between}px vs one column gap ${geo.gap}px`,
          )
          .toBeLessThanOrEqual(0.5);
      }
      // CR2: the same check on a row whose title is TRUNCATED (it fills line one), the case the placement exists for.
      if (mode.compact) {
        const truncated = await rows.evaluateAll((els) =>
          els.findIndex((row) => {
            const t = row.querySelector<HTMLElement>(".spine-row__title")!;
            return t.scrollWidth > t.clientWidth;
          }),
        );
        if (width === 769 && listWidth === "default") {
          expect
            .soft(truncated, `${at}: a truncated title exists to test against`)
            .toBeGreaterThanOrEqual(0);
        }
        if (truncated >= 0) {
          await rows.nth(truncated).locator(".spine-row__select").click();
          await settle(page, width);
          const tg = await rows.nth(truncated).evaluate(triggerGeometry);
          expect
            .soft(
              tg.titleBoxHit,
              `${at}: the trigger's box does not intersect the truncated title's box`,
            )
            .toBe(false);
          expect
            .soft(tg.covered, `${at}: the trigger does not cover the truncated title text`)
            .toBe(0);
          expect
            .soft(tg.overCount || tg.overSummary, `${at}: nothing covered on the truncated row`)
            .toBe(false);
          await rows.nth(1).locator(".spine-row__select").click();
          await settle(page, width);
        }
      }
      // The selected row's trigger opens the menu (real click).
      await rows.nth(1).locator(".spine-row__menu button").click();
      await expect.soft(page.getByRole("menu", { name: /^Step actions for/ })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect.soft(page.getByRole("menu")).toHaveCount(0);

      // An unselected row reveals its menu on hover, and clicking it opens the menu (fine pointer, unchanged).
      await settle(page, width);
      await rows.nth(0).locator(".spine-row__select").hover();
      await expect
        .poll(() => opacityOf(0), { message: `${at}: hover reveals the unselected row's menu` })
        .toBe("1");
      await rows.nth(0).locator(".spine-row__menu button").click();
      await expect.soft(page.getByRole("menu", { name: /^Step actions for/ })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect.soft(page.getByRole("menu")).toHaveCount(0);

      // Keyboard focus on the unselected row's trigger reveals it too.
      await settle(page, width);
      await rows.nth(2).locator(".spine-row__menu button").focus();
      await expect
        .poll(() => opacityOf(2), { message: `${at}: focus reveals the unselected row's menu` })
        .toBe("1");
    }
  }
});

// HEL-1671 item 4 / D3 (D5.3b): an EMPTY markers slot takes no space on a desktop row at any width, so the title
// keeps the 12px (one-line rows) or 8px (compact rows) it used to lose to it.
test("an empty markers slot leaves the flow on every desktop row", async ({ page, request }) => {
  test.setTimeout(180_000);
  const pipelineId = await seedBigPipeline(page, request);
  await openPipeline(page, pipelineId);
  for (const listWidth of ["default", "max"] as const) {
    await setListWidth(page, listWidth);
    for (const width of WIDTHS) {
      await settle(page, width);
      const mode = await spineMode(page);
      const markers = await page.evaluate(() =>
        Array.from(document.querySelectorAll(".spine-body__spine .spine-row__markers:empty")).map(
          (m) => ({
            display: getComputedStyle(m).display,
            width: m.getBoundingClientRect().width,
          }),
        ),
      );
      expect(markers.length).toBeGreaterThanOrEqual(3);
      for (const m of markers) {
        expect
          .soft(m, `${width}px list=${listWidth} compact=${mode.compact}: empty markers slot`)
          .toEqual({ display: "none", width: 0 });
      }
    }
  }
});

// HEL-1671 D1/D5.3c: with no hover (touch), a tap where a row's HIDDEN menu sits selects the row instead of
// opening the menu, at a regular and a compact width.
test.describe("no-hover input", () => {
  test.use({ hasTouch: true });

  test("a tap on a hidden menu selects the row; a second tap on the revealed menu opens it", async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    const pipelineId = await seedBigPipeline(page, request);
    await openPipeline(page, pipelineId);
    expect
      .soft(
        await page.evaluate(() => window.matchMedia("(hover: hover)").matches),
        "the touch context reports no hover",
      )
      .toBe(false);
    const rows = page.locator(".spine-body__spine .spine-row");
    for (const width of [1100, 900]) {
      await settle(page, width);
      const mode = await spineMode(page);
      const at = `${width}px compact=${mode.compact}`;
      // Start from a row that is not selected: select a different row first, then tap the other one's hidden menu.
      const target = rows.nth(0);
      const other = rows.nth(2);
      await other.locator(".spine-row__select").tap();
      await settle(page, width);
      await expect
        .soft(target.locator(".spine-row__select"))
        .not.toHaveAttribute("aria-current", "true");
      const box = (await target.locator(".spine-row__menu button").boundingBox())!;
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      await expect
        .soft(target.locator(".spine-row__select"), `${at}: the tap selects the row`)
        .toHaveAttribute("aria-current", "true");
      await expect.soft(page.getByRole("menu"), `${at}: the tap opened no menu`).toHaveCount(0);
      await settle(page, width);
      const box2 = (await target.locator(".spine-row__menu button").boundingBox())!;
      await page.touchscreen.tap(box2.x + box2.width / 2, box2.y + box2.height / 2);
      await expect
        .soft(
          page.getByRole("menu", { name: /^Step actions for/ }),
          `${at}: the second tap opens the menu`,
        )
        .toBeVisible();
      await page.keyboard.press("Escape");
      await expect.soft(page.getByRole("menu")).toHaveCount(0);
    }
  });
});
