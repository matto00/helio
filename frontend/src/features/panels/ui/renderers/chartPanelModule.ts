// HEL-1760 -- the one place the chart code (`ChartPanel` and, through it, `echarts`) is dynamically imported.
// `ChartRenderer`'s `lazy()` and the early preload share this single `import()` specifier, so the bundler emits one
// non-entry chunk and the browser makes one request for it. Holds no React and no app state (only the pending-import memo), so the Output-metadata
// cache and the public service can call it without pulling a UI dependency into their logic.

type ChartPanelModule = typeof import("../ChartPanel");

let pending: Promise<ChartPanelModule> | null = null;

/** Loads the chart module. Memoised while pending or fulfilled; a rejection clears the memo so the next call retries. */
export function loadChartPanel(): Promise<ChartPanelModule> {
  if (pending === null) {
    const attempt = import("../ChartPanel");
    pending = attempt;
    attempt.catch(() => {
      if (pending === attempt) pending = null;
    });
  }
  return pending;
}

/** Starts loading the chart code as soon as a chart-kind Output is known. Never rejects: a failed preload leaves the
 *  renderer's own `loadChartPanel()` to retry on mount. */
export function preloadChartPanel(): void {
  loadChartPanel().catch(() => undefined);
}
