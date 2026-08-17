import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

export interface ScrollEdgeState {
  /** True once the container has scrolled away from its left edge — there is
   *  more (already-seen) content off-screen to the left. */
  left: boolean;
  /** True while the container hasn't reached its right edge yet — there is
   *  more content to scroll to on the right. */
  right: boolean;
}

const NO_EDGES: ScrollEdgeState = { left: false, right: false };

/**
 * Tracks whether a horizontally-scrollable container has more content
 * off-screen to the left/right, so callers can render a scroll-shadow
 * affordance — a wide table on a phone viewport otherwise gives zero
 * indication that scrolling reveals more columns (HEL a11y/ux sweep F-164).
 *
 * Attach the returned `ref` to the scrollable element itself (the one with
 * `overflow-x: auto`). Re-measures on scroll, on window resize, and via a
 * `ResizeObserver` on both the container and its direct children — the
 * latter is required because a `<table>` growing/shrinking (new rows,
 * column-resize) changes the *content*'s width without changing the
 * container's own box size (it stays clipped by `overflow: auto`), which a
 * container-only observer would miss. The observed elements are the
 * container and whichever children exist at mount time; that's sufficient
 * here because React reconciliation keeps the same `<table>` DOM node alive
 * across re-renders (only its cells change), so nothing needs to be
 * re-observed later.
 */
export function useScrollEdges<T extends HTMLElement>(): {
  ref: RefObject<T | null>;
  edges: ScrollEdgeState;
} {
  const ref = useRef<T>(null);
  const [edges, setEdges] = useState<ScrollEdgeState>(NO_EDGES);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const maxScrollLeft = el.scrollWidth - el.clientWidth;
    setEdges({
      left: el.scrollLeft > 1,
      right: maxScrollLeft - el.scrollLeft > 1,
    });
  }, []);

  // Measure synchronously after paint so the shadow is correct on first
  // render (no flash of "no shadow" on an already-overflowing table).
  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    let observer: ResizeObserver | undefined;
    // jsdom (Jest) has no ResizeObserver — feature-detect rather than crash.
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(measure);
      observer.observe(el);
      for (const child of Array.from(el.children)) observer.observe(child);
    }
    return () => {
      el.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [measure]);

  return { ref, edges };
}
