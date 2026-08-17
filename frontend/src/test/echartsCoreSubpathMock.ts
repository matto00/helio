// F-022 — global Jest stand-in for ECharts' `/core`, `/charts`,
// `/components`, and `/renderers` subpath exports.
//
// `echartsCore.ts` imports these directly (rather than the full `echarts`
// package) to selectively register only the chart types/components
// `ChartPanel` actually uses, so bundlers can tree-shake the rest away. Like
// `echarts-for-react/esm/core` (see `echartsForReactCoreMock.tsx`), every one
// of these subpaths is ESM-only in `echarts`'s package exports map — there's
// no CommonJS build for ts-jest's default transform to fall back to — so any
// test that transitively imports `ChartPanel` without mocking `echartsCore`
// itself hits a `SyntaxError: Cannot use import statement outside a module`
// several `node_modules` layers deep.
//
// One mock file covers all four subpaths (wired via `jest.config.cjs`'s
// `moduleNameMapper`): the real `echartsCore.ts` module still runs for real
// in tests that don't mock it away entirely, registering these stand-ins
// against a no-op `use()` — harmless, since the chart itself is rendered by
// `echarts-for-react`'s mock (`echartsForReactCoreMock.tsx`), which never
// touches its `echarts` prop.
export function use(): void {
  // No-op — nothing reads ECharts' internal registry in tests.
}

class MockEChartsRegisterable {}

export const BarChart = MockEChartsRegisterable;
export const LineChart = MockEChartsRegisterable;
export const PieChart = MockEChartsRegisterable;
export const ScatterChart = MockEChartsRegisterable;
export const GridComponent = MockEChartsRegisterable;
export const LegendComponent = MockEChartsRegisterable;
export const TooltipComponent = MockEChartsRegisterable;
export const CanvasRenderer = MockEChartsRegisterable;
