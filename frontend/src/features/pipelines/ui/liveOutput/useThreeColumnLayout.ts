import { useLayoutEffect, useState, type RefObject } from "react";

/** The page width from which the spine, the centre column and the live Output column fit side by side (design.md D7). Below
 *  it the Output renders as a collapsible section under the preview table. */
export const THREE_COLUMN_MIN_WIDTH = 960;

/** Whether the element is wide enough for three columns. Measured before paint and on resize; an environment without
 *  `ResizeObserver` (jsdom) keeps the wide default, so tests see the column. */
export function useThreeColumnLayout(ref: RefObject<HTMLElement | null>): boolean {
  const [wide, setWide] = useState(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const measure = () => {
      const width = el.getBoundingClientRect().width;
      // A zero width is an unlaid-out element (jsdom, display: none), not a narrow one.
      if (width > 0) setWide(width >= THREE_COLUMN_MIN_WIDTH);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return wide;
}
