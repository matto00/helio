import { useLayoutEffect, useRef, type RefObject } from "react";

import { useMotion } from "../../theme/ThemeProvider";
import { isInstant, readMotionDuration, readMotionEasing } from "./motionTokens";

/** Marks a child of a layout-slide container; the value identifies the item across renders. */
export const LAYOUT_SLIDE_KEY_ATTRIBUTE = "data-motion-key";

interface Position {
  x: number;
  y: number;
}

/** Layout slide (HEL-1573, DESIGN.md §10): FLIP over the container's `data-motion-key` children. After every commit
 *  the layout position (`offsetLeft`/`offsetTop`, which ignore transforms) of each keyed child is recorded; a child
 *  that moved since the last commit is animated from its old offset to its new place with the Web Animations API over
 *  `--motion-duration-move` and `--motion-ease-out`. Only Full animates: under Subtle and Off no animation is
 *  scheduled at all, so items jump. Attach the returned ref to the list's container. Flow lists only, never
 *  react-grid-layout items (the grid slides through its own CSS transforms). */
export function useLayoutSlide<T extends HTMLElement>(): RefObject<T | null> {
  const containerRef = useRef<T | null>(null);
  const previous = useRef<Map<string, Position>>(new Map());
  const motion = useMotion();

  // Runs after every commit on purpose: any render can add, remove or resize a sibling.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const items = container.querySelectorAll<HTMLElement>(`[${LAYOUT_SLIDE_KEY_ATTRIBUTE}]`);
    const current = new Map<string, Position>();
    items.forEach((item) => {
      const key = item.getAttribute(LAYOUT_SLIDE_KEY_ATTRIBUTE);
      if (key !== null) current.set(key, { x: item.offsetLeft, y: item.offsetTop });
    });

    if (motion === "full") {
      const duration = readMotionDuration("--motion-duration-move");
      if (!isInstant(duration)) {
        const easing = readMotionEasing("--motion-ease-out");
        items.forEach((item) => {
          const key = item.getAttribute(LAYOUT_SLIDE_KEY_ATTRIBUTE);
          const before = key === null ? undefined : previous.current.get(key);
          const after = key === null ? undefined : current.get(key);
          if (!before || !after || typeof item.animate !== "function") return;
          const dx = before.x - after.x;
          const dy = before.y - after.y;
          if (dx === 0 && dy === 0) return;
          item.animate(
            [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }],
            { duration, easing },
          );
        });
      }
    }
    previous.current = current;
  });

  return containerRef;
}
