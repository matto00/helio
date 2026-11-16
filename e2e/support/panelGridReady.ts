import { expect, type Page } from "@playwright/test";

// HEL-1633 - readiness gate for specs that count or measure `.react-grid-item`s right after a dashboard load.
//
// While panels load, `PanelGridSkeleton` renders its own react-grid-layout, so its stub cards are `.react-grid-item`s
// too. Since HEL-1584 the skeleton layer (`.crossfade__skeleton`) stays mounted (aria-hidden, inert) for a moment
// after the real grid appears, so for that moment the DOM holds BOTH sets of items. A bare `.react-grid-item` count or
// box read in that window can see the stubs, which collapse to zero size as the layer unmounts.

/** The real grid's items: the live crossfade layer only, never the fading skeleton layer. */
export const LIVE_GRID_ITEMS = ".crossfade__layer:not(.crossfade__skeleton) .react-grid-item";

/**
 * Waits until the real panel grid shows `count` items and the loading skeleton has unmounted.
 *
 * Order matters: (1) the live-layer items reach `count` - a positive anchor only the real grid can satisfy;
 * (2) `getByLabel("Loading panels")` reaches 0 - `getByLabel` does not filter aria-hidden nodes, so this means the
 * skeleton layer is unmounted, not merely that loading ended. Step 2 alone, straight after `goto`, passes vacuously
 * before React has mounted anything.
 *
 * Desktop widths only: at phone widths the skeleton is a `MobilePanelStackSkeleton` and the real grid renders no
 * `.react-grid-item`s, so step 1 would time out. Use `waitForPanelStack` there (HEL-1724).
 */
export async function waitForPanelGrid(
  page: Page,
  count: number,
  { timeout = 15_000 }: { timeout?: number } = {},
): Promise<void> {
  await expect(page.locator(LIVE_GRID_ITEMS)).toHaveCount(count, { timeout });
  await expect(page.getByLabel("Loading panels")).toHaveCount(0, { timeout });
}

/**
 * HEL-1724 - the phone-width twin of `LIVE_GRID_ITEMS`: the real stack's cards, never the fading skeleton's stubs
 * (`MobilePanelStackSkeleton` renders `.mobile-panel-stack__item` stubs too).
 *
 * The descendant combinator matches any item under a non-skeleton `.crossfade__layer`. If an ancestor non-skeleton
 * layer were ever added (e.g. the route wrapped in a `RouteSuspense` crossfade) it would match the stubs as well;
 * step 2 of `waitForPanelStack` still catches that, so the wait stays sound.
 */
export const LIVE_STACK_ITEMS =
  ".crossfade__layer:not(.crossfade__skeleton) .mobile-panel-stack__item";

/**
 * Waits until the real phone stack shows `count` cards and the loading skeleton has unmounted.
 *
 * Same two steps, in the same order, and for the same reasons as `waitForPanelGrid`: the live-layer count is the
 * positive anchor, and `getByLabel("Loading panels")` reaching 0 means the skeleton layer is gone (its stubs are
 * `.mobile-panel-stack__item`s that overlap the real cards until it unmounts: a gap read then was -380px).
 *
 * Phone widths only (below the stack breakpoint): at desktop widths the real grid has no
 * `.mobile-panel-stack__item`s, so step 1 would time out. Use `waitForPanelGrid` there.
 */
export async function waitForPanelStack(
  page: Page,
  count: number,
  { timeout = 15_000 }: { timeout?: number } = {},
): Promise<void> {
  await expect(page.locator(LIVE_STACK_ITEMS)).toHaveCount(count, { timeout });
  await expect(page.getByLabel("Loading panels")).toHaveCount(0, { timeout });
}
