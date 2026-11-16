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
 * `.react-grid-item`s, so step 1 would time out.
 */
export async function waitForPanelGrid(
  page: Page,
  count: number,
  { timeout = 15_000 }: { timeout?: number } = {},
): Promise<void> {
  await expect(page.locator(LIVE_GRID_ITEMS)).toHaveCount(count, { timeout });
  await expect(page.getByLabel("Loading panels")).toHaveCount(0, { timeout });
}
