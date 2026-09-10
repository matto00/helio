import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from "react";

export interface VirtualRowsResult {
  /** First row index to mount (inclusive). */
  startIndex: number;
  /** Last row index to mount (exclusive). */
  endIndex: number;
  /** Height (px) of the leading spacer `<tr>` standing in for rows above
   *  `startIndex` — 0 when there are none. */
  topSpacerPx: number;
  /** Height (px) of the trailing spacer `<tr>` standing in for rows below
   *  `endIndex` — 0 when there are none. */
  bottomSpacerPx: number;
}

const DISABLED_RESULT = (rowCount: number): VirtualRowsResult => ({
  startIndex: 0,
  endIndex: rowCount,
  topSpacerPx: 0,
  bottomSpacerPx: 0,
});

/**
 * HEL-458 design D1/D2 — hand-rolled windowing math (no third-party
 * dependency, see design.md's library-vs-hand-rolled decision record).
 * Computes which row indices should be mounted for the current scroll
 * position, plus the top/bottom spacer heights that preserve total
 * scrollable height as though every row were mounted (D2: ordinary
 * flow-layout spacer `<tr>`s, not `position: absolute` rows, so
 * `table-layout: fixed` and HEL-465's sticky pinned-column offsets need no
 * special-casing).
 *
 * `scrollRef` is the SAME ref `useScrollEdges` already attaches its own
 * scroll listener to (D7) — this hook adds a second `{ passive: true }`
 * listener to that element rather than requesting a second `ref={}`
 * attachment, which would clobber the scroll-shadow affordance.
 */
export function useVirtualRows({
  scrollRef,
  rowCount,
  rowHeight,
  overscan = 10,
  enabled,
}: {
  scrollRef: RefObject<HTMLElement | null>;
  rowCount: number;
  rowHeight: number;
  /** Rows mounted beyond each edge of the visible viewport, so a small
   *  scroll or resize doesn't have to wait a render cycle for new rows to
   *  appear — also the buffer that masks the brief window the `scroll`/
   *  `ResizeObserver` measurement above hasn't yet caught up with a change.
   *  10 is not derived from a specific measurement; it is a conservative
   *  starting point in the same spirit as `VIRTUALIZATION_ROW_THRESHOLD`
   *  (design D4) — independently tunable if a live sweep finds it wrong. */
  overscan?: number;
  enabled: boolean;
}): VirtualRowsResult {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
    setViewportHeight(el.clientHeight);
  }, [scrollRef]);

  useLayoutEffect(() => {
    if (!enabled) return;
    measure();
  }, [enabled, measure]);

  useEffect(() => {
    if (!enabled) return;
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", measure, { passive: true });
    // HEL-458 evaluation-1.md Change Request #1 — `scroll` alone misses a
    // container that GROWS without an intervening scroll (e.g. dragging a
    // dashboard panel's resize handle): `viewportHeight` stays pinned to
    // whatever it was at mount/last-scroll, so the mounted window is sized
    // for the OLD (smaller) viewport and a blank strip opens up below the
    // last mounted row. jsdom has no `ResizeObserver` (feature-detected,
    // matching `useScrollEdges`'s own guard for the same environment gap).
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(measure);
      observer.observe(el);
    }
    return () => {
      el.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [enabled, measure, scrollRef]);

  if (!enabled || rowHeight <= 0 || rowCount === 0) {
    return DISABLED_RESULT(rowCount);
  }

  // `viewportHeight === 0` before first real paint (jsdom, or a not-yet-
  // measured browser frame) — fall back to an overscan-sized slice so the
  // pre-measurement render (D3) still bounds mounted rows rather than
  // rendering every row.
  const visibleCount = viewportHeight > 0 ? Math.ceil(viewportHeight / rowHeight) : overscan;
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endIndex = Math.min(rowCount, startIndex + visibleCount + overscan * 2);
  const topSpacerPx = startIndex * rowHeight;
  const bottomSpacerPx = Math.max(0, (rowCount - endIndex) * rowHeight);

  return { startIndex, endIndex, topSpacerPx, bottomSpacerPx };
}
