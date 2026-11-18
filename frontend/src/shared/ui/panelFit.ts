/** Minimum gap kept between a fitted panel and the viewport edge. */
export const VIEWPORT_MARGIN = 8;

export interface PanelFitOptions {
  /** Gap between the trigger and the panel. */
  gap: number;
  /** A CSS height cap the panel never exceeds; absent means only the room limits it. */
  cap?: number;
  /** The side tried first. */
  prefer: "below" | "above";
  /** Height of a fixed band at the bottom of the viewport (the phone bottom nav, the safe area) that is not usable
   *  room: it shrinks the room below the trigger only. Defaults to 0. */
  bottomInset?: number;
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
  { gap, cap, prefer, bottomInset = 0 }: PanelFitOptions,
): PanelFit {
  const roomBelow = viewportHeight - bottomInset - (trigger.bottom + gap) - VIEWPORT_MARGIN;
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

let safeAreaProbe: HTMLElement | null = null;

/** The measured `env(safe-area-inset-bottom)` in px, via a lazily created hidden fixed probe (0 where unsupported). */
function readSafeAreaBottom(): number {
  // The probe node stays in <body> on purpose: it is created once and reused, so it is not leaked per call.
  if (!safeAreaProbe || !safeAreaProbe.isConnected) {
    safeAreaProbe = document.createElement("div");
    safeAreaProbe.setAttribute("aria-hidden", "true");
    safeAreaProbe.style.cssText =
      "position:fixed;left:0;bottom:0;width:0;visibility:hidden;pointer-events:none;height:env(safe-area-inset-bottom, 0px)";
    document.body.appendChild(safeAreaProbe);
  }
  return safeAreaProbe.getBoundingClientRect().height;
}

/** HEL-1762 -- height of the fixed band at the bottom of the viewport that a popover must not cover: the rendered
 *  phone bottom nav (measured, so it follows the nav's own tokens and safe-area offset) unless `panel` sits inside an
 *  open modal dialog, whose top layer covers the nav; otherwise just the safe-area inset. 0 on desktop and in jsdom. */
export function readBottomInset(panel?: Element | null): number {
  const nav = panel?.closest("dialog[open]") ? null : document.querySelector(".bottom-nav");
  const navRect = nav?.getBoundingClientRect();
  const band =
    navRect && navRect.height > 0 ? window.innerHeight - navRect.top : readSafeAreaBottom();
  return Math.max(0, band);
}
