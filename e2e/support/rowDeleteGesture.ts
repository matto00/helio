import type { Locator, Page } from "@playwright/test";
import { waitForWebFonts } from "./webFonts";

// Shared by the HEL-1574 / HEL-1605 row-Delete specs: placing a row, and recording what each mouse press of a
// gesture lands on and where the row sits at that moment.

/** Scrolls the page so `button`'s bottom sits about 75px above the viewport bottom: the confirm row inserted below it
 *  would open off-screen, which is the layout that used to scroll the page between a double-click's two clicks. */
export async function placeBottomNearViewportEdge(page: Page, button: Locator): Promise<void> {
  await settledRowTop(button);
  await button.scrollIntoViewIfNeeded();
  await page.locator(".app-content").evaluate(
    (el, selectorLabel) => {
      const target = document.querySelector<HTMLElement>(`button[aria-label="${selectorLabel}"]`)!;
      const delta = target.getBoundingClientRect().bottom - (window.innerHeight - 75);
      el.scrollTop += delta;
    },
    await button.getAttribute("aria-label"),
  );
}

/** The row's top once its layout has stopped moving (late fetches such as the references summary re-flow rows, and
 *  the web-font swap shrinks every row ~2px 100-250ms after first paint, HEL-1606). Every row gesture computes its
 *  point from this, so the font wait lives here; it reads fonts, never labels. */
export async function settledRowTop(button: Locator): Promise<number> {
  await waitForWebFonts(button);
  let previous = Number.NaN;
  let current = await button.evaluate((el) => el.closest("tr")!.getBoundingClientRect().top);
  for (let i = 0; i < 20 && current !== previous; i++) {
    previous = current;
    await button.page().waitForTimeout(150);
    current = await button.evaluate((el) => el.closest("tr")!.getBoundingClientRect().top);
  }
  return current;
}

/** Records which element each mouse press of the next gesture lands on (capture phase, so nothing can hide it) and,
 *  when `trackLabel` names a button, the top of that button's row at each press (the layout the press saw). */
export async function recordPresses(page: Page, trackLabel?: string): Promise<void> {
  await page.evaluate((label) => {
    const presses: string[] = [];
    const tops: number[] = [];
    const store = window as unknown as { __presses: string[]; __rowTops: number[] };
    store.__presses = presses;
    store.__rowTops = tops;
    document.addEventListener(
      "mousedown",
      (event) => {
        const target = event.target as HTMLElement;
        const button = target.closest("button");
        presses.push(button?.getAttribute("aria-label") ?? button?.textContent ?? target.tagName);
        const tracked =
          label === undefined
            ? null
            : document.querySelector<HTMLElement>(`button[aria-label="${label}"]`);
        if (tracked !== null) tops.push(tracked.closest("tr")!.getBoundingClientRect().top);
      },
      true,
    );
  }, trackLabel);
}

export async function pressTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __presses: string[] }).__presses);
}

/** The tracked row's top at each recorded press. */
export async function pressRowTops(page: Page): Promise<number[]> {
  return page.evaluate(() => (window as unknown as { __rowTops: number[] }).__rowTops);
}

/** The vertical scroller of the page. */
export function pageScroller(page: Page): Locator {
  return page.locator(".app-content");
}

/** Whether the Delete button's row still shows a first-minute relative-time label (the rows are fresh), asserted
 *  immediately before a gesture so the test proves it runs in the layout the defect needs. */
export async function freshRowLabel(button: Locator): Promise<string> {
  return button.evaluate((el) => el.closest("tr")!.innerText);
}

export const FRESH_LABEL = /just now|seconds? ago/;

/** Bottom edge of the element named by `selector` (first match), the BottomNav's top, and the viewport height. */
export async function revealGeometry(
  page: Page,
  groupName: string,
): Promise<{ groupTop: number; groupBottom: number; navTop: number | null; viewport: number }> {
  return page.evaluate((name) => {
    const group = document.querySelector<HTMLElement>(`[role="group"][aria-label="${name}"]`);
    const nav = document.querySelector<HTMLElement>(".bottom-nav");
    const box = group?.getBoundingClientRect();
    const navVisible = nav !== null && getComputedStyle(nav).display !== "none";
    return {
      groupTop: box?.top ?? Number.NaN,
      groupBottom: box?.bottom ?? Number.NaN,
      navTop: navVisible ? nav.getBoundingClientRect().top : null,
      viewport: window.innerHeight,
    };
  }, groupName);
}

/** Makes the rows of the next page load read as fresh, then lets the test make time pass without a tick.
 *
 *  The defect needs a table rendered within a second of its rows' creation (labels "just now") and re-rendered a few
 *  seconds later (the press), where the old code recomputed every label from the wall clock. A real run only hits it
 *  by timing luck, so the browser clock is installed to start before the earliest row (everything reads "just now"),
 *  and `agePage` jumps it forward -- time passing between render and press, with no shared tick in between. */
export async function installFreshClock(page: Page, listUrls: string[]): Promise<number> {
  let earliest = Number.POSITIVE_INFINITY;
  for (const url of listUrls) {
    const res = await page.request.get(url);
    const body = (await res.json()) as unknown;
    const items = (Array.isArray(body) ? body : ((body as { items?: unknown[] }).items ?? [])) as {
      updatedAt?: string;
    }[];
    for (const item of items) {
      if (item.updatedAt) earliest = Math.min(earliest, Date.parse(item.updatedAt));
    }
  }
  if (!Number.isFinite(earliest)) throw new Error("installFreshClock: no rows with an updatedAt");
  const start = earliest - 1500;
  await page.clock.install({ time: start });
  return start;
}

/** Puts the (already installed) browser clock back before the rows, for a second page load in the same test. */
export async function rewindClock(page: Page, start: number): Promise<void> {
  await page.clock.setSystemTime(start);
}

/** Seconds pass without any timer firing more than once (the shared 60 s tick is not reached). */
export async function agePage(page: Page, ms = 8000): Promise<void> {
  await page.clock.fastForward(ms);
}

/** From the next mouse press on, samples the row's top and the page's scrollTop every animation frame for 1.5 s, stamped with the time since
 *  that press. Timing is measured in the page, so a loaded runner cannot skew "nothing moved before the reveal". */
export async function watchRowTop(page: Page, label: string): Promise<void> {
  await page.evaluate((name) => {
    const samples: { t: number; top: number; scrollTop: number }[] = [];
    (window as unknown as { __topSamples: typeof samples }).__topSamples = samples;
    document.addEventListener(
      "mousedown",
      () => {
        const t0 = performance.now();
        const sample = () => {
          const button = document.querySelector<HTMLElement>(`button[aria-label="${name}"]`);
          const t = performance.now() - t0;
          if (button !== null)
            samples.push({
              t,
              top: button.closest("tr")!.getBoundingClientRect().top,
              scrollTop: document.querySelector(".app-content")!.scrollTop,
            });
          if (t < 1500) requestAnimationFrame(sample);
        };
        sample();
      },
      { capture: true, once: true },
    );
  }, label);
}

export async function rowTopSamples(
  page: Page,
): Promise<{ t: number; top: number; scrollTop: number }[]> {
  return page.evaluate(
    () =>
      (window as unknown as { __topSamples: { t: number; top: number; scrollTop: number }[] })
        .__topSamples,
  );
}

/** Navigates to an overview route once its late data has landed: the Sources page fetches its "Used by" references
 *  after first paint and re-flows the rows when they arrive, which would otherwise shift a row mid-gesture for a
 *  reason unrelated to the interaction under test. */
export async function gotoSettled(page: Page, route: string): Promise<void> {
  const references =
    route === "/sources" ? page.waitForResponse("**/api/data-sources/references*") : null;
  await page.goto(route);
  await references;
}
