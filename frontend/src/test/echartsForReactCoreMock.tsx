// F-022 — global Jest stand-in for `echarts-for-react/lib/core`.
//
// `ChartPanel.tsx` renders via `echarts-for-react`'s `/lib/core` entry point
// (paired with our own selectively-registered `echarts` instance —
// `echartsCore.ts` — instead of the default `echarts-for-react` export) so
// bundlers can tree-shake the full, non-tree-shakeable `echarts` package
// (1.12 MB min / 369 KB gzip) down to just the chart types/components this
// app actually uses. Under Jest, `lib/core` resolves through the package's
// `default` condition to the CommonJS build (`lib/core.js`); Vite resolves the
// `module` condition to the ESM build (`esm/core.js`) instead, and tsc reads
// the `types` entry (`lib/core.d.ts`).
// This stand-in replaces the real component so a test that transitively
// imports `ChartPanel` without its own `jest.mock("echarts-for-react/lib/core", ...)`
// gets a deterministic stub rather than a real canvas-backed ECharts instance
// (which jsdom cannot render).
//
// Wired in via `jest.config.cjs`'s `moduleNameMapper` (same pattern already
// used there for `react-markdown`/`remark-gfm`, also ESM-only) so every test
// file gets a working stand-in without needing its own mock. `ChartPanel
// .test.tsx` declares its own local `jest.mock("echarts-for-react/lib/core",
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
