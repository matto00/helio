import { expect, test, type APIRequestContext, type CDPSession, type Page } from "@playwright/test";

import { registerAndLogin } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import { isolateLivePage } from "./support/isolateLivePage";
import { post, seedWorld, setMotion } from "./support/motionPrimitivesSeed";

// HEL-1656: pull-to-refresh on the phone dashboard, driven by REAL touch input (CDP Input.dispatchTouchEvent; Playwright's
// own touchscreen only taps) in a hasTouch + isMobile context at 375 and 390. Rows requests are counted from the
// network, containment is read from the computed style (headless Chromium cannot show the native pull-to-refresh, so the
// computed `overscroll-behavior-y` is the proof), and Motion Off is sampled by waiting for the state, never a sleep.

test.use({ isMobile: true, hasTouch: true });
test.describe.configure({ mode: "parallel" });

const AUTH = { prefix: "hel1656", displayName: "HEL-1656", domain: "example.com" } as const;
const ROWS = /\/api\/outputs\/[^/]+\/rows/;
const SIZES = [
  { width: 375, height: 812 },
  { width: 390, height: 844 },
] as const;
async function shot(page: Page, name: string) {
  await page.screenshot({ path: evidencePath("HEL-1656", `${name}.png`) });
}

async function openDashboard(
  page: Page,
  request: APIRequestContext,
  width: number,
  height: number,
  label: string,
  options: { motion?: "full" | "subtle" | "off"; theme?: "light" | "dark" } = {},
) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(
    (t) => window.localStorage.setItem("helio-theme", t),
    options.theme ?? "light",
  );
  await registerAndLogin(page, request, { ...AUTH, label });
  await isolateLivePage(page);
  if (options.motion) await setMotion(page.request, options.motion);
  const world = await seedWorld(page.request, `P${label}`);
  // A text panel (no output: a pull must not touch it) and enough long markdown that the page scrolls.
  for (let n = 1; n <= 4; n += 1) {
    await post(page.request, "/api/panels", {
      dashboardId: world.dashboardId,
      title: `Notes ${n}`,
      type: "markdown",
      config: {
        content: Array.from({ length: 8 }, () => "Lorem ipsum dolor sit amet.").join("\n\n"),
      },
    });
  }
  const seen = countRows(page);
  await page.goto(`/dashboards/${world.dashboardId}`);
  await expect(page.locator(".mobile-panel-stack")).toHaveCount(1);
  await expect(page.locator(".mobile-panel-stack__item--output")).toHaveCount(3);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // The initial loads: every output panel fetched its rows and none is still spinning.
  await expect.poll(() => seen.urls.length).toBeGreaterThanOrEqual(3);
  await expect(page.locator(".mobile-panel-stack__item--output .ui-spinner")).toHaveCount(0);
  return { ...world, seen };
}

async function client(page: Page): Promise<CDPSession> {
  return page.context().newCDPSession(page);
}

async function touch(
  cdp: CDPSession,
  type: "touchStart" | "touchMove" | "touchEnd",
  x: number,
  y: number,
) {
  await cdp.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: type === "touchEnd" ? [] : [{ x, y }],
  });
}

/** Press at (x, y) and drag `distance` px down in small steps, leaving the finger down. */
async function dragDown(cdp: CDPSession, x: number, y: number, distance: number) {
  await touch(cdp, "touchStart", x, y);
  const steps = Math.ceil(distance / 10);
  for (let i = 1; i <= steps; i += 1) {
    await touch(cdp, "touchMove", x, y + Math.min(distance, i * 10));
  }
}

/** A point on the first output card, below the page chrome, to start touches on. */
async function cardPoint(page: Page) {
  const card = page.locator(".mobile-panel-stack__item").first();
  await expect(card).toBeVisible();
  let box: { x: number; y: number; width: number } | null = null;
  await expect
    .poll(async () => {
      box = await card.boundingBox();
      return box !== null;
    })
    .toBe(true);
  const { x, y, width } = box!;
  return { x: x + width / 2, y: y + 24 };
}

/** Animation frames a layout or scroll reading must hold unchanged to count as settled. */
const STABLE_FRAMES = 6;

/**
 * The first Notes (markdown) card whose visible band leaves room for a 150px downward drag above the bottom nav, as a
 * touch point inside its content box. Markdown cards carry no nested scroller on the phone stack, so a drag from one
 * can only pan the page (the Table panel's resize handles are `touch-action: none` and its body scrolls on its own).
 */
async function notesTouchPoint(page: Page, drag: number) {
  const point = await page.evaluate((reach) => {
    const top = document.querySelector(".app-content")!.getBoundingClientRect().top;
    const nav = document.querySelector(".bottom-nav")?.getBoundingClientRect().top ?? innerHeight;
    const minY = top + 8;
    const maxY = Math.min(nav, innerHeight) - reach - 8;
    for (const card of document.querySelectorAll(".mobile-panel-stack__item--markdown")) {
      const r = card.getBoundingClientRect();
      const from = Math.max(r.top, minY);
      const to = Math.min(r.bottom - 8, maxY);
      if (to - from >= 8) return { x: r.left + r.width / 2, y: Math.round((from + to) / 2) };
    }
    return null;
  }, drag);
  expect(point, "a Notes card with room for the drag inside the viewport").not.toBeNull();
  return point!;
}

/**
 * What the finger would land on at (x, y): it must be inside a Notes card, with no ancestor up to `.app-content` that
 * restricts touch-action, is a nested scroller (overflow auto/scroll with overflowing content), or is already scrolled.
 * Returns the hit chain so a failure names the element (a Table resize handle, a nested scroller...).
 */
function touchBlockers(page: Page, x: number, y: number) {
  return page.evaluate(
    ([px, py]) => {
      const root = document.querySelector(".app-content")!;
      const hit = document.elementFromPoint(px, py);
      const chain: string[] = [];
      const problems: string[] = [];
      if (!hit || !hit.closest(".mobile-panel-stack__item--markdown"))
        problems.push("not inside a Notes card");
      for (let el = hit; el && el !== root; el = el.parentElement) {
        const cs = getComputedStyle(el);
        const name = `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}`;
        chain.push(name);
        if (cs.touchAction !== "auto") problems.push(`${name} touch-action ${cs.touchAction}`);
        const scrolls = /auto|scroll/.test(cs.overflowY) && el.scrollHeight > el.clientHeight;
        if (scrolls || el.scrollTop > 0) problems.push(`${name} is a nested scroller`);
      }
      return { problems, chain: chain.join(" < ") };
    },
    [x, y] as const,
  );
}

/** The snap pill is not clipped by the wrapper and overlaps neither the first card's title text nor any chip control. */
async function expectPillClear(page: Page) {
  const r = await page.evaluate(() => {
    const rect = (el: Element | Range) => el.getBoundingClientRect();
    const hit = (a: DOMRect, b: DOMRect) =>
      a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const pill = rect(document.querySelector(".pull-refresh-indicator")!);
    const title = document.querySelector(".mobile-panel-stack__item .panel-grid-card__title")!;
    const range = document.createRange();
    range.selectNodeContents(title);
    const chips = Array.from(document.querySelectorAll(".dashboard-chip")).map(rect);
    return {
      clip: getComputedStyle(document.querySelector(".mobile-panel-pull")!).clipPath,
      size: [pill.width, pill.height],
      overlapsTitle: hit(pill, rect(range)),
      overlapsChip: chips.some((c) => hit(pill, c)),
    };
  });
  expect(r.size[0]).toBeGreaterThan(40);
  expect(r.clip).toBe("none");
  expect(r.overlapsTitle).toBe(false);
  expect(r.overlapsChip).toBe(false);
}

function countRows(page: Page) {
  const urls: string[] = [];
  const runs: string[] = [];
  page.on("request", (req) => {
    if (ROWS.test(req.url()) && req.method() === "GET") urls.push(req.url());
    if (/\/runs\b/.test(req.url()) && req.method() === "POST") runs.push(req.url());
  });
  return { urls, runs };
}

for (const size of SIZES) {
  test.describe(`HEL-1656 pull to refresh at ${size.width}`, () => {
    test("a pull past the threshold refreshes each output panel once, runs no pipeline, and opens no detail", async ({
      page,
      request,
    }) => {
      const { seen } = await openDashboard(
        page,
        request,
        size.width,
        size.height,
        `pull${size.width}`,
      );
      const cdp = await client(page);
      const before = seen.urls.length;

      const { x, y } = await cardPoint(page);
      await dragDown(cdp, x, y, 260);
      await expect(page.locator(".pull-refresh-indicator")).toHaveAttribute("data-state", "ready");
      await shot(page, `pulling-${size.width}`);
      await touch(cdp, "touchEnd", x, y);

      await expect.poll(() => seen.urls.length - before).toBe(3);
      await expect(page.locator(".pull-refresh-indicator")).toHaveCount(0);
      await expect(page.locator(".mobile-panel-stack")).toHaveCSS("transform", "none");
      expect(seen.runs).toEqual([]);
      await expect(page.locator(".ui-modal[open]")).toHaveCount(0);
      await expect(page.locator(".mobile-panel-pull__status")).toHaveText("Refreshed");
      // No extra requests trickle in after the round settled.
      expect(seen.urls.length - before).toBe(3);
    });

    test("a short pull releases back with no request", async ({ page, request }) => {
      const { seen } = await openDashboard(
        page,
        request,
        size.width,
        size.height,
        `short${size.width}`,
      );
      const before = seen.urls.length;
      const cdp = await client(page);
      const { x, y } = await cardPoint(page);
      await dragDown(cdp, x, y, 70);
      await expect(page.locator(".pull-refresh-indicator")).toHaveAttribute(
        "data-state",
        "pulling",
      );
      await touch(cdp, "touchEnd", x, y);
      await expect(page.locator(".pull-refresh-indicator")).toHaveCount(0);
      await expect(page.locator(".mobile-panel-stack")).toHaveCSS("transform", "none");
      expect(seen.urls.length).toBe(before);
    });

    test("an engaged touchmove is cancelable and prevented, so the page does not scroll natively", async ({
      page,
      request,
    }) => {
      await openDashboard(page, request, size.width, size.height, `cancel${size.width}`);
      const cdp = await client(page);
      await page.evaluate(() => {
        const w = window as unknown as { __moves: Array<[boolean, boolean]> };
        w.__moves = [];
        // Bubble phase on document runs after the gesture's handler on the scroller.
        document.addEventListener(
          "touchmove",
          (e) => w.__moves.push([e.cancelable, e.defaultPrevented]),
          { passive: true },
        );
      });
      const { x, y } = await cardPoint(page);
      await dragDown(cdp, x, y, 120);
      const moves = await page.evaluate(
        () => (window as unknown as { __moves: Array<[boolean, boolean]> }).__moves,
      );
      expect(moves.length).toBeGreaterThan(3);
      // The first moves are inside the slop (not prevented); once engaged every move is cancelable and prevented.
      const engaged = moves.slice(2);
      expect(engaged.every(([cancelable, prevented]) => cancelable && prevented)).toBe(true);
      await touch(cdp, "touchEnd", x, y);
    });

    test("a scrolled page scrolls natively upward and never engages", async ({ page, request }) => {
      await openDashboard(page, request, size.width, size.height, `scrolled${size.width}`);
      const cdp = await client(page);
      // Settled layout first: cards finish sizing after the panels load, which clamps and anchors the scroll offset.
      await expect
        .poll(() =>
          page.evaluate(
            (frames) =>
              new Promise<boolean>((resolve) => {
                const read = () => {
                  const el = document.querySelector(".app-content")!;
                  const card = document.querySelector(".mobile-panel-stack__item--markdown")!;
                  return `${el.scrollHeight}:${card.getBoundingClientRect().top}`;
                };
                const first = read();
                let left = frames;
                const tick = () => {
                  if (read() !== first) return resolve(false);
                  if (--left === 0) return resolve(true);
                  requestAnimationFrame(tick);
                };
                requestAnimationFrame(tick);
              }),
            STABLE_FRAMES,
          ),
        )
        .toBe(true);
      await page.evaluate(() => {
        document.querySelector(".app-content")!.scrollTop = 300;
      });
      // The scroll offset, too, is sampled only once it holds across frames; `start` is that settled value.
      await expect
        .poll(() =>
          page.evaluate(
            (frames) =>
              new Promise<number>((resolve) => {
                const el = document.querySelector(".app-content")!;
                const first = el.scrollTop;
                let left = frames;
                const tick = () => {
                  if (el.scrollTop !== first) return resolve(-1);
                  if (--left === 0) return resolve(first);
                  requestAnimationFrame(tick);
                };
                requestAnimationFrame(tick);
              }),
            STABLE_FRAMES,
          ),
        )
        .toBeGreaterThan(100);
      const start = await page.evaluate(() => document.querySelector(".app-content")!.scrollTop);
      const drag = 150;
      const { x, y } = await notesTouchPoint(page, drag);
      // Precondition, evaluated right before the finger goes down (nothing awaited in between): the drag can only pan.
      const { problems, chain } = await touchBlockers(page, x, y);
      expect(problems, `touch at (${x}, ${y}) lands on ${chain}`).toEqual([]);
      await dragDown(cdp, x, y, drag);
      await expect
        .poll(() => page.evaluate(() => document.querySelector(".app-content")!.scrollTop))
        .toBeLessThan(start);
      await expect(page.locator(".pull-refresh-indicator")).toHaveCount(0);
      await touch(cdp, "touchEnd", x, y + drag);
    });

    test("an upward drag scrolls the page and never engages", async ({ page, request }) => {
      await openDashboard(page, request, size.width, size.height, `up${size.width}`);
      const cdp = await client(page);
      // Precondition: the page can scroll at all.
      await expect
        .poll(() =>
          page.evaluate(() => {
            const el = document.querySelector(".app-content")!;
            return el.scrollHeight - el.clientHeight;
          }),
        )
        .toBeGreaterThan(100);
      // Start on the first card (a plain card, not the table's or the chart's own touch handling).
      const { x, y: top } = await cardPoint(page);
      const y = top + 120;
      await touch(cdp, "touchStart", x, y);
      for (let i = 1; i <= 12; i += 1) {
        await touch(cdp, "touchMove", x, y - i * 8);
        // One frame per move: Chromium only starts a native scroll from moves that span frames.
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
      }
      await expect
        .poll(() => page.evaluate(() => document.querySelector(".app-content")!.scrollTop))
        .toBeGreaterThan(0);
      await expect(page.locator(".pull-refresh-indicator")).toHaveCount(0);
      await touch(cdp, "touchEnd", x, y - 96);
    });

    test("overscroll is contained on the phone dashboard only", async ({ page, request }) => {
      const world = await openDashboard(
        page,
        request,
        size.width,
        size.height,
        `contain${size.width}`,
      );
      const overscroll = () =>
        page.evaluate(() => {
          const el = document.querySelector(".app-content");
          return el ? getComputedStyle(el).overscrollBehaviorY : "missing";
        });
      await expect.poll(overscroll).toBe("contain");
      // Another page: the stack unmounts and the default returns.
      await page.goto("/home");
      await expect(page.locator(".app-content")).toBeVisible();
      await expect.poll(overscroll).toBe("auto");
      // The dashboard again, then desktop width: no containment, no indicator, no stack.
      await page.goto(`/dashboards/${world.dashboardId}`);
      await expect.poll(overscroll).toBe("contain");
      await page.setViewportSize({ width: 1280, height: 900 });
      await expect.poll(overscroll).toBe("auto");
      await expect(page.locator(".mobile-panel-stack")).toHaveCount(0);
      await expect(page.locator(".pull-refresh-indicator")).toHaveCount(0);
    });
  });
}

test.describe("HEL-1656 pull to refresh motion levels", () => {
  for (const motion of ["off", "subtle"] as const) {
    test(`Motion ${motion}: nothing translates mid-pull and the release still refreshes`, async ({
      page,
      request,
    }) => {
      const { seen } = await openDashboard(page, request, 375, 812, `motion${motion}`, { motion });
      const before = seen.urls.length;
      const cdp = await client(page);
      const { x, y } = await cardPoint(page);
      await dragDown(cdp, x, y, 260);
      await expect(page.locator(".pull-refresh-indicator")).toHaveAttribute("data-state", "ready");
      await expect(page.locator(".pull-refresh-indicator--snap")).toHaveCount(1);
      await expect(page.locator(".mobile-panel-stack")).toHaveCSS("transform", "none");
      // Instant: no declared transition, or the global reset near zero (Off resolves tokens to about 0.00001s).
      const transition = await page
        .locator(".pull-refresh-indicator")
        .evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration));
      expect(transition).toBeLessThan(0.001);
      await expectPillClear(page);
      await shot(page, `pulling-${motion}`);
      // Hold the rows requests open so the busy state can be measured too.
      const held: Array<() => Promise<void>> = [];
      await page.route(ROWS, (route) => {
        held.push(() => route.continue());
      });
      await touch(cdp, "touchEnd", x, y);
      await expect.poll(() => seen.urls.length - before).toBe(3);
      await expect(page.locator(".pull-refresh-indicator")).toHaveAttribute("data-state", "busy");
      await expectPillClear(page);
      await expect(page.locator(".mobile-panel-stack")).toHaveCSS("transform", "none");
      for (const release of held) await release();
      await expect(page.locator(".pull-refresh-indicator")).toHaveCount(0);
      await expect(page.locator(".mobile-panel-stack")).toHaveCSS("transform", "none");
    });
  }

  test("Full motion: the stack follows the finger damped, then settles to rest", async ({
    page,
    request,
  }) => {
    await openDashboard(page, request, 375, 812, "follow");
    const cdp = await client(page);
    const { x, y } = await cardPoint(page);
    await dragDown(cdp, x, y, 100);
    // 100px of finger, minus the 6px slop, damped by half.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const m = new DOMMatrixReadOnly(
            getComputedStyle(document.querySelector(".mobile-panel-stack")!).transform,
          );
          return Math.round(m.m42);
        }),
      )
      .toBe(47);
    await touch(cdp, "touchEnd", x, y);
    await expect(page.locator(".mobile-panel-stack")).toHaveCSS("transform", "none");
  });
});

for (const theme of ["light", "dark"] as const) {
  test(`HEL-1656 screenshots at 430 (${theme}): resting, pulling and busy`, async ({
    page,
    request,
  }) => {
    await openDashboard(page, request, 430, 932, `shots${theme}`, { theme });
    const cdp = await client(page);
    await shot(page, `rest-430-${theme}`);
    const { x, y } = await cardPoint(page);
    await dragDown(cdp, x, y, 80);
    await expect(page.locator(".pull-refresh-indicator")).toHaveAttribute("data-state", "pulling");
    await shot(page, `pulling-430-${theme}`);
    await dragDown(cdp, x, y, 0).catch(() => undefined);
    await touch(cdp, "touchMove", x, y + 260);
    await expect(page.locator(".pull-refresh-indicator")).toHaveAttribute("data-state", "ready");
    await shot(page, `ready-430-${theme}`);
    await touch(cdp, "touchEnd", x, y);
  });
}
