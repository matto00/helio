import { useEffect, useState, type RefObject } from "react";

// HEL-UI-SWEEP (F-094/F-026/F-028) — chart-internal density should react to
// the chart's own measured size, not only the mobile-stack-only `compact`
// boolean (`MobilePanelStack.tsx` forwards `compact` unconditionally to
// every chart it renders, regardless of the panel's actual height). ECharts'
// canvas-rendered legend/axis chrome can't be reached by a CSS container
// query — it isn't DOM — so this is the JS-side equivalent, measured on the
// chart's own wrapper (not `.panel-card` itself) so a short *chart* inside a
// taller card (e.g. one with a footnote annotation) still triggers it.

/** Generic small-chart tier (axis-label font shrink + a `grid` sized for the
 *  shrunk labels, F-028): mirrors `panel-card`'s own compact container-query
 *  threshold (`PanelContent.css`, `@container panel-card (max-height:
 *  179px)`) so chart-internal density degrades at the same size the rest of
 *  the card's own chrome does. Applies to every chart type. */
export const CHART_COMPACT_HEIGHT_PX = 179;

/** Pie-only legend-hide tier (F-026): a pie's own outer data-labels extend
 *  well outside its donut radius, so a top/bottom legend collides with them
 *  at a *taller* canvas height than the generic axis-label squeeze does.
 *  Live-repro'd on two default-sized (`h: 4`) chart panels — "Skeptic Pie
 *  Agg Test" (canvas ~227px) and "Mobile Title Test" (canvas ~198px), HEL-248
 *  Chart Config Eval — both garbled the legend into the outer labels. Set
 *  comfortably above both so the default panel size clears it; a
 *  one-row-taller pie panel (`h: 5`+, ~290px+ canvas) keeps its legend. */
export const PIE_LEGEND_HIDE_HEIGHT_PX = 250;

/** The observed element's content-box height in px, or `0` before the first
 *  measurement / in environments without `ResizeObserver` — jsdom/Jest
 *  included, matching the desktop-representative fallback other panel-grid
 *  tests rely on (callers should treat `0` as "unmeasured", not "zero
 *  height"). */
export function useMeasuredChartHeight(ref: RefObject<HTMLElement | null>): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      setHeight(entries[0]?.contentRect.height ?? 0);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);

  return height;
}
