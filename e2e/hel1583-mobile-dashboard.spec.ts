import { expect, test, type Page } from "@playwright/test";
import { registerAndLogin } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import { isolateLivePage } from "./support/isolateLivePage";

// Every test registers its own user and seeds its own data, so tests are independently schedulable.
test.describe.configure({ mode: "parallel" });

// HEL-1583 Phase A -- phone dashboard gutters, the dashboard chip row and the zoom widget off the phone shell, measured
// from rendered pixels (jsdom evaluates no layout or media queries). Text position is read from a text Range rect after
// `document.fonts.ready`, never from a box.

const AUTH = { prefix: "hel1583", displayName: "HEL-1583", domain: "example.com" } as const;
const CSRF = { "X-Helio-Requested-With": "1" };
const WIDTHS = [320, 375, 390, 430, 768] as const;
const THEMES = ["light", "dark"] as const;
const LONG_MARKDOWN = Array.from(
  { length: 6 },
  (_, i) =>
    `Paragraph ${i + 1}: the quick brown fox jumps over the lazy dog, again and again, to fill the line.`,
).join("\n\n");

interface Seeded {
  dashboardIds: string[];
}

async function seed(page: Page, label: string): Promise<Seeded> {
  const dashboardIds: string[] = [];
  for (let i = 1; i <= 8; i += 1) {
    const res = await page.request.post("/api/dashboards", {
      data: { name: `HEL-1583 ${label} Board ${i}` },
      headers: CSRF,
    });
    expect(res.status()).toBe(201);
    dashboardIds.push(((await res.json()) as { id: string }).id);
  }
  // A one-letter name: its chip must still meet the 44px floor (the expander only grows vertically).
  const shortRes = await page.request.post("/api/dashboards", {
    data: { name: "Q" },
    headers: CSRF,
  });
  expect(shortRes.status()).toBe(201);
  // Panels live on the FIRST dashboard (chip order starts with list order) -- and on the last one, to prove a switch.
  for (const [dashboardId, prefix] of [
    [dashboardIds[0], "A"],
    [dashboardIds[dashboardIds.length - 1], "Z"],
  ] as const) {
    for (let n = 1; n <= 3; n += 1) {
      const res = await page.request.post("/api/panels", {
        data: {
          dashboardId,
          title: `${prefix} markdown ${n}`,
          type: "markdown",
          config: { content: `${prefix}-${n} ${LONG_MARKDOWN}` },
        },
        headers: CSRF,
      });
      expect(res.status()).toBe(201);
    }
  }
  return { dashboardIds };
}

async function setTheme(page: Page, theme: string) {
  await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
}

async function open(
  page: Page,
  request: Parameters<typeof registerAndLogin>[1],
  width: number,
  theme: string,
  label: string,
) {
  await page.setViewportSize({ width, height: 800 });
  await setTheme(page, theme);
  await registerAndLogin(page, request, { ...AUTH, label });
  await isolateLivePage(page);
  const seeded = await seed(page, label);
  await page.goto(`/dashboards/${seeded.dashboardIds[0]}`);
  // The markdown renderer is lazy: wait for its body, not just the card.
  await expect(
    page.locator(".mobile-panel-stack__item--markdown .markdown-panel").first(),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return seeded;
}

/** Left/right distances (to the screen edges) of the first markdown panel's rendered text, via a text Range. */
async function markdownTextInsets(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector(".mobile-panel-stack__item--markdown .markdown-panel")!;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let left = Infinity;
    let right = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of Array.from(range.getClientRects())) {
        left = Math.min(left, rect.left);
        right = Math.max(right, rect.right);
      }
    }
    const view = document.documentElement.clientWidth;
    return { left, right: view - right, view };
  });
}

/** Contrast of a chip's label from its RENDERED pixels: the modal pixel is the fill, the pixel farthest from it the ink. */
async function chipLabelContrast(page: Page, selector: string): Promise<number> {
  const png = await page.locator(selector).first().screenshot();
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, img.width, img.height);
    const counts = new Map<string, number>();
    for (let i = 0; i < data.length; i += 4) {
      const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const fill = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])[0][0]
      .split(",")
      .map(Number);
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    let ink = fill;
    let far = -1;
    for (const key of counts.keys()) {
      const px = key.split(",").map(Number);
      const d = Math.abs(lum(px) - lum(fill));
      if (d > far) {
        far = d;
        ink = px;
      }
    }
    const [hi, lo] = [lum(fill), lum(ink)].sort((a, b) => b - a);
    return (hi + 0.05) / (lo + 0.05);
  }, png.toString("base64"));
}

for (const theme of THEMES) {
  test.describe(`HEL-1583 phone dashboard (${theme})`, () => {
    test("markdown text is within 28px of each edge at 375px; cards 12px from the edge; gaps 8-12px", async ({
      page,
      request,
    }) => {
      await open(page, request, 375, theme, `gut${theme}`);
      const insets = await markdownTextInsets(page);
      expect(insets.left).toBeLessThanOrEqual(28);
      // Ragged-right text ends wherever the last word wraps; the AC's right bound is the body box's own edge.
      const boxRight = await page.evaluate(() => {
        const box = document.querySelector(".mobile-panel-stack__item--markdown .markdown-panel")!;
        return document.documentElement.clientWidth - box.getBoundingClientRect().right;
      });
      expect(boxRight).toBeLessThanOrEqual(28);

      const geometry = await page.evaluate(() => {
        const cards = Array.from(
          document.querySelectorAll<HTMLElement>(".mobile-panel-stack__item"),
        );
        const view = document.documentElement.clientWidth;
        const rects = cards.map((c) => c.getBoundingClientRect());
        return {
          view,
          cardLeft: rects.map((r) => r.left),
          cardRightGap: rects.map((r) => view - r.right),
          gaps: rects.slice(1).map((r, i) => r.top - rects[i].bottom),
        };
      });
      expect(geometry.cardLeft.length).toBeGreaterThanOrEqual(3);
      for (const left of geometry.cardLeft) expect(left).toBeCloseTo(12, 0);
      for (const right of geometry.cardRightGap) expect(right).toBeCloseTo(12, 0);
      for (const gap of geometry.gaps) {
        expect(gap).toBeGreaterThanOrEqual(8);
        expect(gap).toBeLessThanOrEqual(12);
      }
    });

    test("a non-panel .panel-list child shares the 12px edge", async ({ page, request }) => {
      await open(page, request, 375, theme, `kid${theme}`);
      const left = await page.evaluate(() => {
        // The row scrolls to reveal the active chip; the first chip sits at the 12px edge at scrollLeft 0.
        document.querySelector(".dashboard-chip-row")!.scrollLeft = 0;
        const first = document.querySelector<HTMLElement>(
          ".panel-list > .dashboard-chip-row .dashboard-chip",
        );
        return first!.getBoundingClientRect().left;
      });
      expect(left).toBeCloseTo(12, 0);
    });

    for (const width of [375, 600, 768]) {
      test(`renders the single-column stack (not the grid) and no zoom widget at ${width}px`, async ({
        page,
        request,
      }) => {
        await open(page, request, width, theme, `stack${width}${theme}`);
        await expect(page.locator(".mobile-panel-stack")).toHaveCount(1);
        await expect(page.locator(".react-grid-layout")).toHaveCount(0);
        await expect(page.locator(".panel-list__zoom-widget")).toHaveCount(0);
        await expect(page.getByRole("group", { name: "Zoom controls" })).toHaveCount(0);
      });
    }

    test("one tap on a chip switches dashboards; the active chip is visible on load, 44px hit areas tile", async ({
      page,
      request,
    }) => {
      const { dashboardIds } = await open(page, request, 375, theme, `chip${theme}`);
      const row = page.getByRole("group", { name: "Dashboards" });
      await expect(row).toBeVisible();

      const active = row.locator("[aria-current='true']");
      await expect(active).toHaveCount(1);
      const within = await page.evaluate(() => {
        const rowEl = document.querySelector(".dashboard-chip-row")!.getBoundingClientRect();
        const chip = document
          .querySelector(".dashboard-chip[aria-current='true']")!
          .getBoundingClientRect();
        return chip.left >= rowEl.left - 0.5 && chip.right <= rowEl.right + 0.5;
      });
      expect(within).toBe(true);

      // Hit areas: the ::after pseudo is 44px tall; measure through elementFromPoint at each chip's top/bottom hit edge.
      const hit = await page.evaluate(() => {
        const chips = Array.from(document.querySelectorAll<HTMLElement>(".dashboard-chip"));
        const rects = chips.map((c) => c.getBoundingClientRect());
        const cs = chips.map((c) => getComputedStyle(c, "::after"));
        const heights = cs.map((s) => parseFloat(s.height));
        const overlaps = rects.slice(1).some((r, i) => r.left < rects[i].right);
        return { heights, overlaps, count: chips.length, painted: rects.map((r) => r.height) };
      });
      expect(hit.count).toBe(9);
      for (const h of hit.heights) expect(h).toBeGreaterThanOrEqual(44);
      for (const h of hit.painted) expect(h).toBe(32);
      expect(hit.overlaps).toBe(false);

      // Short-name chip ("Q"): bisect its real hit area with elementFromPoint, width and height both >= 44 (minus the
      // 1px sampling step). Scrolled into view first; the probe samples a 1px grid along each axis through its centre.
      await row.getByRole("button", { name: "Q", exact: true }).scrollIntoViewIfNeeded();
      const qHit = await page.evaluate(() => {
        const chip = Array.from(document.querySelectorAll<HTMLElement>(".dashboard-chip")).find(
          (c) => c.getAttribute("aria-label") === "Q",
        )!;
        const r = chip.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const hits = (x: number, y: number) => {
          const el = document.elementFromPoint(x, y);
          return el !== null && (el === chip || chip.contains(el));
        };
        let w = 0;
        for (let d = 0; d < 60 && hits(cx - d, cy); d += 1) w += 1;
        for (let d = 1; d < 60 && hits(cx + d, cy); d += 1) w += 1;
        let h = 0;
        for (let d = 0; d < 60 && hits(cx, cy - d); d += 1) h += 1;
        for (let d = 1; d < 60 && hits(cx, cy + d); d += 1) h += 1;
        return { w, h, painted: r.width };
      });
      expect(qHit.w).toBeGreaterThanOrEqual(44 - 1);
      expect(qHit.h).toBeGreaterThanOrEqual(44 - 1);

      // The last dashboard carries panels titled "Z ..."; scroll its chip into view first (swipe), then ONE tap.
      const target = row.getByRole("button", { name: /Board 8$/ });
      await target.scrollIntoViewIfNeeded();
      await target.click();
      await expect(page).toHaveURL(new RegExp(`/dashboards/${dashboardIds[7]}$`));
      await expect(
        page.getByRole("button", { name: /Board 8$/ }).and(page.locator("[aria-current='true']")),
      ).toBeVisible();
      await expect(page.locator(".mobile-panel-stack__item").first()).toContainText("Z");
      // Independent of fixture/chip order: whichever chip was tapped ends up fully inside the row once the smooth
      // scroll settles.
      await expect
        .poll(() =>
          page.evaluate(() => {
            const rowEl = document.querySelector(".dashboard-chip-row")!.getBoundingClientRect();
            const chip = document
              .querySelector(".dashboard-chip[aria-current='true']")!
              .getBoundingClientRect();
            return chip.left >= rowEl.left - 0.5 && chip.right <= rowEl.right + 0.5;
          }),
        )
        .toBe(true);
    });

    test("the last card sits above the glass nav when scrolled to the end", async ({
      page,
      request,
    }) => {
      await open(page, request, 375, theme, `clr${theme}`);
      const result = await page.evaluate(async () => {
        const scroller = document.querySelector<HTMLElement>(".app-content")!;
        const nodes = [
          document.scrollingElement,
          scroller,
          document.querySelector(".app-body"),
        ] as (Element | null)[];
        for (const n of nodes) if (n) n.scrollTop = n.scrollHeight;
        window.scrollTo(0, document.body.scrollHeight);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const cards = Array.from(document.querySelectorAll(".mobile-panel-stack__item"));
        const last = cards[cards.length - 1].getBoundingClientRect();
        const nav = document.querySelector(".bottom-nav")!.getBoundingClientRect();
        return { lastBottom: last.bottom, navTop: nav.top };
      });
      expect(result.lastBottom).toBeLessThanOrEqual(result.navTop);
    });
  });
}

// Rendered-pixel measurements + screenshots for measurements.md (task 2.2). Written to e2e-evidence/HEL-1583.
test.describe("HEL-1583 measurements", () => {
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      test(`measure ${width}px ${theme}`, async ({ page, request }) => {
        await open(page, request, width, theme, `m${width}${theme}`);
        const insets = await markdownTextInsets(page);
        const chips = await page.evaluate(() => {
          const row = document.querySelector<HTMLElement>(".dashboard-chip-row")!;
          const chipEls = Array.from(row.querySelectorAll<HTMLElement>(".dashboard-chip"));
          const rects = chipEls.map((c) => c.getBoundingClientRect());
          const rowRect = row.getBoundingClientRect();
          const activeRect = row
            .querySelector(".dashboard-chip[aria-current='true']")!
            .getBoundingClientRect();
          return {
            firstChipLeft: rects[0].left,
            painted: rects.map((r) => r.height),
            hit: chipEls.map((c) => parseFloat(getComputedStyle(c, "::after").height)),
            overlap: rects.slice(1).some((r, i) => r.left < rects[i].right),
            activeVisible:
              activeRect.left >= rowRect.left - 0.5 && activeRect.right <= rowRect.right + 0.5,
            scrollLeft: row.scrollLeft,
          };
        });
        const stack = await page.evaluate(() => {
          const cards = Array.from(
            document.querySelectorAll<HTMLElement>(".mobile-panel-stack__item"),
          );
          const rects = cards.map((c) => c.getBoundingClientRect());
          const view = document.documentElement.clientWidth;
          return {
            stackRendered: document.querySelector(".mobile-panel-stack") !== null,
            gridRendered: document.querySelector(".react-grid-layout") !== null,
            zoomWidgets: document.querySelectorAll(".panel-list__zoom-widget").length,
            cardLeft: rects[0].left,
            cardRightGap: view - rects[0].right,
            gaps: rects.slice(1).map((r, i) => Math.round((r.top - rects[i].bottom) * 100) / 100),
            hasHorizontalOverflow: document.documentElement.scrollWidth > view,
          };
        });
        // Before the contrast probes: an element screenshot scrolls the row, so this is the as-loaded state.
        await page.screenshot({ path: evidencePath("HEL-1583", `phone-${width}-${theme}.png`) });
        const contrast = {
          active: await chipLabelContrast(page, ".dashboard-chip[aria-current='true']"),
          inactive: await chipLabelContrast(page, ".dashboard-chip:not([aria-current])"),
        };
        expect(contrast.active).toBeGreaterThanOrEqual(4.5);
        expect(contrast.inactive).toBeGreaterThanOrEqual(4.5);
        const out = { width, theme, insets, chips, stack, contrast };
        console.log(`HEL1583-MEASURE ${JSON.stringify(out)}`);
        expect(stack.stackRendered).toBe(true);
        expect(stack.zoomWidgets).toBe(0);
        expect(chips.overlap).toBe(false);
        expect(chips.activeVisible).toBe(true);
      });
    }
  }
});
