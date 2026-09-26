import type { ReactElement } from "react";
import { render } from "@testing-library/react";

import { ThemeProvider } from "../../../theme/ThemeProvider";

// HEL-1180 — shared across every `ChartPanel.*.test.tsx` split file. Each
// file still declares its OWN `jest.mock("echarts-for-react/esm/core", ...)`
// / `jest.mock("./echartsCore", ...)` calls at its own top level — Jest's
// mock-hoisting (`babel-plugin-jest-hoist`) only hoists `jest.mock()` calls
// within the file they're written in, so moving those calls into this shared
// helper module would silently stop mocking in every file that imports it
// instead of calling `jest.mock` itself (design.md D6).

/** `ChartPanel` reads `useTheme()` (F-024/F-025 — a theme flip must recompute
 *  its ECharts option, see the component's own comment), which throws outside
 *  a `ThemeProvider`. Every render in the split test files goes through here
 *  rather than `@testing-library/react`'s bare `render` — no Redux/router
 *  dependency, so the shared `renderWithStore` test helper (which pulls both
 *  in) would be more than these files need. */
export function renderChart(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

export function getOption(el: HTMLElement) {
  return JSON.parse(el.getAttribute("data-option") ?? "{}") as Record<string, unknown>;
}

export const baseAppearance = {
  background: "transparent",
  color: "inherit",
  transparency: 0,
};

export const baseChartConfig = {
  seriesColors: [],
  legend: { show: true, position: "top" as const },
  tooltip: { enabled: true },
  axisLabels: {
    x: { show: true, label: "X" },
    y: { show: true, label: "Y" },
  },
};
