// Shared type-only helpers for e2e specs that walk a React fiber to a chart's ECharts instance.
// Types only: they are erased at compile time, so nothing is serialized into `page.evaluate` closures.

export type EchartsInstance = {
  getOption(): { series?: unknown[]; legend?: { show?: boolean; type?: string }[] };
  getDom(): Element;
};
export type ReactFiber = {
  stateNode?: { getEchartsInstance?: () => EchartsInstance } | null;
  return?: ReactFiber | null;
};
