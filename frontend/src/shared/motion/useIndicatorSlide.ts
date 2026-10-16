import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

import { useMotion } from "../../theme/ThemeProvider";

import "./motion.css";

/** The attribute that marks the active item inside an indicator-slide container. */
export const INDICATOR_ACTIVE_ATTRIBUTE = "data-indicator-active";

/** Indicator slide (HEL-1573, DESIGN.md §10): measures the item carrying `data-indicator-active` and writes its offset
 *  and size to the container as `--indicator-x/-y/-w/-h`; a `.motion-indicator` child translates and resizes to them over
 *  `--motion-duration-move` (see `motion.css`, so Subtle and Off move it with no animation).
 *
 *  The container must be a positioned element whose offset parent the items share, hold the `.motion-indicator`
 *  element, and mark the active item with `data-indicator-active`. The container's `data-indicator` attribute is
 *  `hidden` with no active item, `snap` for a placement made without a transition (the first one, and the first after
 *  the indicator was hidden, so it never slides in from the origin), and `ready` once a frame has passed. It re-measures
 *  after every commit and when the container resizes. Outside Full every placement is a `snap`. */
export function useIndicatorSlide<T extends HTMLElement>(): RefObject<T | null> {
  const containerRef = useRef<T | null>(null);
  const settleFrame = useRef(0);
  const motion = useMotion();
  const motionRef = useRef(motion);
  useLayoutEffect(() => {
    motionRef.current = motion;
  });

  function measure() {
    const container = containerRef.current;
    if (container === null) return;
    const active = container.querySelector<HTMLElement>(`[${INDICATOR_ACTIVE_ATTRIBUTE}]`);
    if (active === null) {
      cancelAnimationFrame(settleFrame.current);
      container.setAttribute("data-indicator", "hidden");
      return;
    }
    // Read every offset first, decide snap, and only then write: a read after the first write flushes style while the
    // container is still `ready`, which starts the 280ms transition that a later `snap` does not cancel.
    const { offsetLeft, offsetTop, offsetWidth, offsetHeight } = active;
    // Outside Full the indicator never slides: the move token only drops to 0.01ms once the root attribute lands, which
    // is after the commit that moved it, so a Full-speed slide would otherwise start (the Motion group's own control).
    const snap =
      motionRef.current !== "full" || container.getAttribute("data-indicator") !== "ready";
    if (snap) container.setAttribute("data-indicator", "snap");
    const style = container.style;
    style.setProperty("--indicator-x", `${offsetLeft}px`);
    style.setProperty("--indicator-y", `${offsetTop}px`);
    style.setProperty("--indicator-w", `${offsetWidth}px`);
    style.setProperty("--indicator-h", `${offsetHeight}px`);
    if (snap) {
      cancelAnimationFrame(settleFrame.current);
      // Two frames: the first paints the un-transitioned placement, the second may then transition.
      settleFrame.current = requestAnimationFrame(() => {
        settleFrame.current = requestAnimationFrame(() =>
          container.setAttribute("data-indicator", "ready"),
        );
      });
    }
  }

  // After every commit: the active item or its layout may have changed.
  useLayoutEffect(measure);

  useEffect(() => {
    const container = containerRef.current;
    const frame = settleFrame;
    if (container === null || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => measure());
    observer.observe(container);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame.current);
    };
  }, []);

  return containerRef;
}
