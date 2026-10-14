import { expect, type Page } from "@playwright/test";

import { settleTransitions } from "./settleTransitions";

/**
 * HEL-1413 / HEL-1418 — wait until the desktop grid has PROCESSED a given container width.
 *
 * After a live `setViewportSize` the `.panel-grid` CSS box follows the viewport at once, but React
 * Grid Layout only receives the new width after a ResizeObserver -> rAF -> setWidth chain that needs
 * rendering opportunities, so under load items still sit at the previous breakpoint's geometry while
 * the box is already correct. `DesktopPanelGrid` therefore reports the width RGL last processed
 * (`onWidthChange`) as the observability-only `--panel-grid-processed-width` custom property, and
 * this helper gates on THAT, never on the CSS box width.
 *
 * Expected width: the caller passes the grid CONTAINER width it expects, never read from the DOM.
 * `containerWidthForViewport` derives it from a viewport width (container = viewport - 288 with the
 * sidebar open, viewport - 40 under 1056; see the header of
 * hel1023-breakpoint-layout-derivation.spec.ts, which instead lists its containers explicitly).
 *
 * Below 768 (`panelGridConfig.breakpoints.sm`) the phone stack replaces RGL, and it swaps in only
 * once the same chain delivers the width, so the wait is for the desktop grid to be gone instead.
 */
const PHONE_STACK_BELOW = 768;

/** The grid container width the app produces for a viewport width (sidebar open from 1056 up). */
export function containerWidthForViewport(viewportWidth: number): number {
  return viewportWidth >= 1056 ? viewportWidth - 288 : viewportWidth - 40;
}

export interface WaitForGridWidthOptions {
  /** Skip the trailing wait for the item transitions the width commit starts. Default: wait. */
  skipSettle?: boolean;
  timeoutMs?: number;
}

export async function waitForGridWidth(
  page: Page,
  containerWidth: number,
  { skipSettle = false, timeoutMs = 15_000 }: WaitForGridWidthOptions = {},
): Promise<void> {
  if (containerWidth < PHONE_STACK_BELOW) {
    await expect(page.locator(".panel-grid")).toHaveCount(0, { timeout: timeoutMs });
    return;
  }
  let lastObserved = "<never read>";
  try {
    await expect
      .poll(
        async () => {
          lastObserved = await page
            .locator(".panel-grid")
            .evaluate(
              (el) => el.style.getPropertyValue("--panel-grid-processed-width"),
              undefined,
              {
                timeout: 2_000,
              },
            )
            .catch(() => "<no .panel-grid>");
          return lastObserved;
        },
        { timeout: timeoutMs },
      )
      .toBe(`${containerWidth}px`);
  } catch (error) {
    throw new Error(
      `grid never processed ${containerWidth}px (last --panel-grid-processed-width: ${lastObserved})`,
      { cause: error },
    );
  }
  if (!skipSettle) await settleTransitions(page, 5_000);
}
