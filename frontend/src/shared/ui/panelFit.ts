/** Minimum gap kept between a fitted panel and the viewport edge. */
export const VIEWPORT_MARGIN = 8;

export interface PanelFitOptions {
  /** Gap between the trigger and the panel. */
  gap: number;
  /** A CSS height cap the panel never exceeds; absent means only the room limits it. */
  cap?: number;
  /** The side tried first. */
  prefer: "below" | "above";
}

export interface PanelFit {
  side: "below" | "above";
  /** Distance from the viewport top when the panel opens below, or where its top edge lands when it opens above. */
  top: number;
  /** Distance from the viewport bottom to the panel's bottom edge when it opens above (anchor for a `bottom`-placed panel). */
  bottom: number;
  maxHeight: number;
}

/** Where a fixed-position panel must sit so all of it is reachable inside the viewport. It opens on the preferred side of
 *  its trigger when the whole panel fits there; otherwise on the other side when that side has MORE room; otherwise on
 *  the preferred side. Whenever it does not fit its side, its height is capped to that side's room so the rest scrolls
 *  inside the panel. `naturalHeight` is the full height the panel wants (content plus chrome), independent of any cap
 *  applied earlier. A `naturalHeight` of 0 means no layout is known: the preferred side, uncapped. */
export function fitPanelVertically(
  trigger: { top: number; bottom: number },
  naturalHeight: number,
  viewportHeight: number,
  { gap, cap, prefer }: PanelFitOptions,
): PanelFit {
  const roomBelow = viewportHeight - (trigger.bottom + gap) - VIEWPORT_MARGIN;
  const roomAbove = trigger.top - gap - VIEWPORT_MARGIN;
  const place = (side: "below" | "above", maxHeight: number): PanelFit => ({
    side,
    top: side === "below" ? trigger.bottom + gap : trigger.top - gap - maxHeight,
    bottom: viewportHeight - (trigger.top - gap),
    maxHeight,
  });
  if (naturalHeight <= 0) {
    return { ...place(prefer, 0), maxHeight: Number.POSITIVE_INFINITY };
  }
  const height = cap === undefined ? naturalHeight : Math.min(naturalHeight, cap);
  const preferredRoom = prefer === "below" ? roomBelow : roomAbove;
  const otherRoom = prefer === "below" ? roomAbove : roomBelow;
  const other = prefer === "below" ? "above" : "below";
  if (height <= preferredRoom) return place(prefer, height);
  if (otherRoom > preferredRoom) return place(other, Math.max(Math.min(height, otherRoom), 0));
  return place(prefer, Math.max(preferredRoom, 0));
}
