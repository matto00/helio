// F-022 — global Jest stand-in for `echarts-for-react/esm/core`.
//
// `ChartPanel.tsx` renders via `echarts-for-react`'s `/esm/core` entry point
// (paired with our own selectively-registered `echarts` instance —
// `echartsCore.ts` — instead of the default `echarts-for-react` export) so
// bundlers can tree-shake the full, non-tree-shakeable `echarts` package
// (1.12 MB min / 369 KB gzip) down to just the chart types/components this
// app actually uses. That entry point is ESM-only (no CommonJS build under
// `echarts-for-react/esm/`), which ts-jest's default CommonJS transform
// can't parse when a test transitively imports `ChartPanel` without its own
// `jest.mock("echarts-for-react/esm/core", ...)` — the failure mode is a
// `SyntaxError: Cannot use import statement outside a module` coming from
// deep inside `node_modules`, not from any app code.
//
// Wired in via `jest.config.cjs`'s `moduleNameMapper` (same pattern already
// used there for `react-markdown`/`remark-gfm`, also ESM-only) so every test
// file gets a working stand-in without needing its own mock. `ChartPanel
// .test.tsx` declares its own local `jest.mock("echarts-for-react/esm/core",
// ...)` for option-shape assertions — a local `jest.mock` always wins over
// this global mapping for that one file, so this mock only ever applies
// where no test cares about the actual chart option passed in.
import * as React from "react";

interface MockEChartsProps {
  option?: unknown;
  [key: string]: unknown;
}

export default function MockReactECharts({ option }: MockEChartsProps) {
  return <div data-testid="echarts" data-option={JSON.stringify(option)} />;
}
