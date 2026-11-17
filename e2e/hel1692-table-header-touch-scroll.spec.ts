import { expect, test, type APIRequestContext, type CDPSession, type Page } from "@playwright/test";

import { registerAndLogin } from "./support/auth";
import { isolateLivePage } from "./support/isolateLivePage";
import { post } from "./support/motionPrimitivesSeed";
import { waitForPanelGrid, waitForPanelStack } from "./support/panelGridReady";

// HEL-1692: GUARDS (not fails-first proof) that no part of a phone Table header restricts a vertical page pan. The
// reported bug (a drag from a `touch-action: none` column-resize handle cannot scroll the page) did NOT reproduce in
// Chromium: 8/8 drags scrolled, including under CPU throttle (owner ruling: ship `pan-y` as a guard; iOS WebKit is
// untested). Driven by REAL touch input (CDP Input.dispatchTouchEvent; Playwright's touchscreen only taps), as
// e2e/hel1656-pull-to-refresh.spec.ts does.
//
//  - G1 static: every element on the handle's hit chain permits a vertical pan (failable: restore `none` on the handle).
//  - G2 behavioural: a vertical drag from a handle, and from header text, scrolls the page (failable by touch-action
//    `none` on its own path, the hit th up to the Table card; see the PR body for the mutation transcripts).
//  - G3 desktop: a mouse drag on a handle still widens the column.
//  - Capped body: a drag inside a vertically overflowing grid at scrollTop 0 chains to the page.

test.use({ isMobile: true, hasTouch: true });
test.describe.configure({ mode: "parallel" });

const AUTH = { prefix: "hel1692", displayName: "HEL-1692", domain: "example.com" } as const;
const SIZES = [
  { width: 375, height: 812 },
  { width: 430, height: 932 },
] as const;
const STABLE_FRAMES = 6;

/** A dashboard with 3 Notes cards, then one Table panel (`rows` rows), then 3 more Notes cards. */
async function seed(request: APIRequestContext, tag: string, rows: number) {
  const dash = await post<{ id: string }>(request, "/api/dashboards", { name: `${tag} Dash` });
  const source = await post<{ id: string }>(request, "/api/data-sources", {
    name: `${tag} source`,
    type: "static",
    columns: [
      { name: "region", type: "string", required: true },
      { name: "amount", type: "integer", required: true },
    ],
    rows: Array.from({ length: rows }, (_, n) => [`Region ${n}`, 100 + n]),
  });
  const pipeline = await post<{ id: string }>(request, "/api/pipelines", {
    name: `${tag} pipeline`,
    roots: [{ sourceId: source.id }],
  });
  const table = await post<{ id: string }>(request, `/api/pipelines/${pipeline.id}/outputs`, {
    kind: "table",
    name: `${tag} table`,
    config: {},
  });
  await post(request, `/api/pipelines/${pipeline.id}/run`, {});
  const notes = async (from: number, to: number) => {
    for (let n = from; n <= to; n += 1) {
      await post(request, "/api/panels", {
        dashboardId: dash.id,
        title: `Notes ${n}`,
        type: "markdown",
        config: { content: Array.from({ length: 8 }, () => "Lorem ipsum dolor.").join("\n\n") },
      });
    }
  };
  await notes(1, 3);
  await post(request, "/api/panels", {
    dashboardId: dash.id,
    title: `${tag} Table`,
    type: "output",
    config: { outputId: table.id },
  });
  await notes(4, 6);
  return dash.id;
}

async function openPhone(
  page: Page,
  request: APIRequestContext,
  size: { width: number; height: number },
  label: string,
  rows: number,
) {
  await page.setViewportSize(size);
  await registerAndLogin(page, request, { ...AUTH, label });
  await isolateLivePage(page);
  const id = await seed(page.request, label, rows);
  await page.goto(`/dashboards/${id}`);
  await waitForPanelStack(page, 7);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await expect(
    page.locator(".mobile-panel-stack__item--output .ui-data-grid__table"),
  ).toBeVisible();
  await expect(page.locator(".mobile-panel-stack .ui-spinner")).toHaveCount(0);
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

/**
 * Press at (x, y), drag `distance` px down in 10px steps one frame apart, release. Returns whether the pull-to-refresh
 * indicator showed at any point of the gesture (it must not while the page is scrolled away from the top).
 */
async function dragDown(page: Page, cdp: CDPSession, x: number, y: number, distance: number) {
  let engaged = false;
  await touch(cdp, "touchStart", x, y);
  for (let i = 1; i <= Math.ceil(distance / 10); i += 1) {
    await touch(cdp, "touchMove", x, y + Math.min(distance, i * 10));
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    if ((await page.locator(".pull-refresh-indicator").count()) > 0) engaged = true;
  }
  await touch(cdp, "touchEnd", x, y + distance);
  return engaged;
}

/** Resolves once `read()` holds the same value across STABLE_FRAMES animation frames. */
function settled(page: Page, expr: string) {
  return expect
    .poll(() =>
      page.evaluate(
        ([source, frames]) =>
          new Promise<boolean>((resolve) => {
            const read = new Function(`return (${source})`) as () => unknown;
            const first = JSON.stringify(read());
            let left = frames as number;
            const tick = () => {
              if (JSON.stringify(read()) !== first) return resolve(false);
              if (--left === 0) return resolve(true);
              requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          }),
        [expr, STABLE_FRAMES] as const,
      ),
    )
    .toBe(true);
}

const PAGE_STATE =
  "(() => { const e = document.querySelector('.app-content'); const t = document.querySelector('.mobile-panel-stack__item--output'); return [e.scrollHeight, e.scrollTop, t.getBoundingClientRect().top]; })()";

/** Scrolls `.app-content` so the Table card's top sits ~120px below the page top, then waits for it to hold. */
async function scrollTableIntoView(page: Page) {
  await settled(page, PAGE_STATE);
  await page.evaluate(() => {
    const el = document.querySelector(".app-content")!;
    const card = document.querySelector(".mobile-panel-stack__item--output")!;
    el.scrollTop += card.getBoundingClientRect().top - el.getBoundingClientRect().top - 120;
  });
  await settled(page, PAGE_STATE);
  const top = await pageScroll(page);
  expect(top, "page scrolled away from the top, with room to scroll back up").toBeGreaterThan(100);
}

const pageScroll = (page: Page) =>
  page.evaluate(() => document.querySelector(".app-content")!.scrollTop);

/** Centre of the first Table header resize handle in the viewport, asserted to be what a finger would hit. */
async function handlePoint(page: Page) {
  const r = await page.evaluate(() => {
    const vw = innerWidth;
    for (const h of document.querySelectorAll(
      ".mobile-panel-stack__item--output .ui-data-grid__resize-handle",
    )) {
      const b = h.getBoundingClientRect();
      // Left half of the 8px handle lies inside its own header cell, so it is not clipped by the cell.
      const x = b.left + b.width / 4;
      const y = b.top + b.height / 2;
      if (x > 24 && x < vw - 24) {
        const hit = document.elementFromPoint(x, y);
        return { x, y, hit: hit?.className ?? null, ok: hit === h };
      }
    }
    return null;
  });
  expect(r, "a visible resize handle").not.toBeNull();
  expect(r!.ok, `touch at (${r!.x}, ${r!.y}) hit ${r!.hit}, not the resize handle`).toBe(true);
  return r!;
}

/** Centre of the first header label text, asserted to be inside a `th` and not on a resize handle. */
async function headerTextPoint(page: Page) {
  const r = await page.evaluate(() => {
    const th = document.querySelector(".mobile-panel-stack__item--output thead th")!;
    const b = th.getBoundingClientRect();
    const x = b.left + 12;
    const y = b.top + b.height / 2;
    const hit = document.elementFromPoint(x, y);
    return {
      x,
      y,
      hit: hit?.className ?? null,
      ok: !!hit && th.contains(hit) && !hit.closest(".ui-data-grid__resize-handle"),
    };
  });
  expect(r.ok, `touch at (${r.x}, ${r.y}) hit ${r.hit}`).toBe(true);
  return r;
}

for (const size of SIZES) {
  test.describe(`HEL-1692 at ${size.width}`, () => {
    test("G2 guard: a vertical drag from a Table header resize handle scrolls the page", async ({
      page,
      request,
    }) => {
      await openPhone(page, request, size, `handle${size.width}`, 4);
      const cdp = await page.context().newCDPSession(page);
      await scrollTableIntoView(page);
      const start = await pageScroll(page);
      const { x, y } = await handlePoint(page);
      const engaged = await dragDown(page, cdp, x, y, 120);
      // Dragging down pans the page up: scrollTop falls, and no pull-to-refresh engaged along the way.
      await expect.poll(() => pageScroll(page)).toBeLessThan(start - 40);
      expect(engaged).toBe(false);
    });

    test("G2 guard: a vertical drag from Table header text scrolls the page", async ({
      page,
      request,
    }) => {
      await openPhone(page, request, size, `text${size.width}`, 4);
      const cdp = await page.context().newCDPSession(page);
      await scrollTableIntoView(page);
      const start = await pageScroll(page);
      const { x, y } = await headerTextPoint(page);
      const engaged = await dragDown(page, cdp, x, y, 120);
      await expect.poll(() => pageScroll(page)).toBeLessThan(start - 40);
      expect(engaged).toBe(false);
    });

    test("G1 guard: no element on the handle's hit chain restricts a vertical pan", async ({
      page,
      request,
    }) => {
      await openPhone(page, request, size, `static${size.width}`, 4);
      await scrollTableIntoView(page);
      const { x, y } = await handlePoint(page);
      const chain = await page.evaluate(
        ([px, py]) => {
          const out: string[] = [];
          for (let e: Element | null = document.elementFromPoint(px, py); e; e = e.parentElement) {
            const ta = getComputedStyle(e).touchAction;
            const ok = ta === "auto" || ta === "manipulation" || ta.includes("pan-y");
            out.push(
              `${e.tagName.toLowerCase()}.${String(e.className).split(" ")[0]}[${ta}]${ok ? "" : " BLOCKS"}`,
            );
            if (e.classList.contains("app-content")) break;
          }
          return out;
        },
        [x, y] as const,
      );
      expect(chain[0]).toContain("ui-data-grid__resize-handle");
      expect(chain.at(-1)).toContain("app-content");
      expect(
        chain.filter((c) => c.endsWith("BLOCKS")),
        chain.join(" < "),
      ).toEqual([]);
    });

    test("capped body: a downward drag in a vertically overflowing grid at scrollTop 0 chains to the page", async ({
      page,
      request,
    }) => {
      await openPhone(page, request, size, `capped${size.width}`, 80);
      const cdp = await page.context().newCDPSession(page);
      await scrollTableIntoView(page);
      // C1: the live cap is `.panel-content` (it never overflows); the vertical scroller is the `.ui-data-grid` inside
      // it. Prove, right before the drag, that the grid overflows and both sit at scrollTop 0, so chaining is not vacuous.
      const body = await page.evaluate(() => {
        const cap = document.querySelector(
          ".mobile-panel-stack__item--output .panel-content",
        ) as HTMLElement;
        const grid = cap.querySelector(".ui-data-grid") as HTMLElement;
        const g = grid.getBoundingClientRect();
        const row = grid.querySelector("tbody tr")!.getBoundingClientRect();
        return {
          gridOverflows: grid.scrollHeight - grid.clientHeight,
          gridScrollTop: grid.scrollTop,
          capScrollTop: cap.scrollTop,
          x: g.left + g.width / 2,
          y: row.top + row.height / 2,
          inView: row.top > g.top && row.bottom < Math.min(g.bottom, innerHeight - 100),
          hit: document.elementFromPoint(g.left + g.width / 2, row.top + row.height / 2)?.tagName,
        };
      });
      expect(body.gridOverflows, ".ui-data-grid overflows vertically").toBeGreaterThan(100);
      expect(body.gridScrollTop).toBe(0);
      expect(body.capScrollTop).toBe(0);
      expect(body.inView).toBe(true);
      expect(body.hit).toBe("TD");
      const start = await pageScroll(page);
      await dragDown(page, cdp, body.x, body.y, 120);
      // The grid was already at its top bound, so the gesture chains to the page (page scrolls up).
      await expect.poll(() => pageScroll(page)).toBeLessThan(start - 40);
      expect(
        await page.evaluate(
          () =>
            document.querySelector(".mobile-panel-stack__item--output .ui-data-grid")!.scrollTop,
        ),
      ).toBe(0);
    });
  });
}

test.describe("HEL-1692 desktop resize", () => {
  test.use({ isMobile: false, hasTouch: false });

  test("G3 guard: a mouse drag on a resize handle still widens the column", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await registerAndLogin(page, request, { ...AUTH, label: "desktop" });
    await isolateLivePage(page);
    const id = await seed(page.request, "desktop", 4);
    await page.goto(`/dashboards/${id}`);
    await waitForPanelGrid(page, 7);
    const th = page.locator(".panel-content--table thead th").first();
    const handle = page.locator(".panel-content--table .ui-data-grid__resize-handle").first();
    await expect(handle).toBeVisible();
    const before = (await th.boundingBox())!.width;
    await handle.scrollIntoViewIfNeeded();
    const b = (await handle.boundingBox())!;
    const x = b.x + b.width / 4;
    const y = b.y + b.height / 2;
    const hit = await page.evaluate(
      ([px, py]) => document.elementFromPoint(px, py)?.className ?? null,
      [x, y] as const,
    );
    expect(hit, "the mouse lands on the resize handle").toBe("ui-data-grid__resize-handle");
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 30, y, { steps: 5 });
    await page.mouse.move(x + 60, y, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => (await th.boundingBox())!.width).toBeGreaterThan(before + 30);
  });
});
