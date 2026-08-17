import { render, screen } from "@testing-library/react";

import { ChartRenderer } from "./ChartRenderer";
import { ThemeProvider } from "../../../../theme/ThemeProvider";

// The ECharts canvas is irrelevant to the annotation footnote under test; mock
// it so the renderer's own DOM (the annotation element) is what we assert on.
// F-022 — `ChartPanel` now renders via `echarts-for-react`'s `/esm/core`
// entry point (tree-shaking; see `ChartPanel.tsx`'s docblock), not the
// default `echarts-for-react` export this mock used to target.
jest.mock("echarts-for-react/esm/core", () => ({
  __esModule: true,
  default: () => <div data-testid="echarts" />,
}));

// F-022/F-231 — `ChartPanel`'s option-building `useMemo` reads `useTheme()`
// (to recompute when the user flips light/dark; see `ChartPanel.tsx`'s
// docblock above its `useTheme()` call), so it now requires a `ThemeProvider`
// ancestor to render at all.
function renderChartRenderer(annotation?: string | null) {
  return render(
    <ThemeProvider>
      <ChartRenderer annotation={annotation} />
    </ThemeProvider>,
  );
}

// HEL-512 — `ChartPanel` is now a `React.lazy` target inside `ChartRenderer` (design.md Decision
// 1). `React.lazy`'s loader promise is memoized once per `ChartRenderer` module instance (module
// scope, matching production) — Jest shares one module registry across every test in this file, so
// once any test resolves it, every later render of `ChartRenderer` in this file sees the already-
// fulfilled chunk and never re-suspends (mirrors real dynamic-import caching in the browser). The
// "still pending" fallback state is therefore only observable in the very first test that touches
// the module below — it must stay first, and it awaits the resolution itself before finishing so
// the transition doesn't leak an "update not wrapped in act(...)" warning into whichever test runs
// next. Every other test here awaits `screen.findByTestId(...)` (Suspense-aware) rather than the
// old synchronous `getByTestId`.
describe("ChartRenderer — Suspense fallback (HEL-512)", () => {
  it("shows the shared panel-loading fallback before the chart chunk resolves", async () => {
    renderChartRenderer();
    expect(screen.getByLabelText("Loading data")).toBeInTheDocument();
    expect(screen.queryByTestId("echarts")).not.toBeInTheDocument();
    // Drain the mocked dynamic import within this test's own act() scope (see the file-level
    // comment above) rather than leaving it to resolve during the next test.
    await screen.findByTestId("echarts");
  });

  it("replaces the fallback with the chart once the chunk resolves", async () => {
    renderChartRenderer();
    expect(await screen.findByTestId("echarts")).toBeInTheDocument();
    expect(screen.queryByLabelText("Loading data")).not.toBeInTheDocument();
  });

  // specs/frontend-code-splitting/spec.md — "Chart panel renders normally once its chunk loads":
  // no console errors on mount, matching echarts-chart-panel's own "No console errors on mount"
  // scenario, now exercised through the lazy-loaded path.
  it("mounts through the fallback → chart transition with no console errors", async () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    renderChartRenderer();
    await screen.findByTestId("echarts");
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});

describe("ChartRenderer — annotation footnote (HEL-318)", () => {
  it("renders the annotation beneath the chart when set", async () => {
    renderChartRenderer("Source: Bureau of Labor Statistics");
    expect(await screen.findByTestId("echarts")).toBeInTheDocument();
    expect(screen.getByText("Source: Bureau of Labor Statistics")).toBeInTheDocument();
  });

  it("renders no annotation element when annotation is absent", async () => {
    const { container } = renderChartRenderer();
    await screen.findByTestId("echarts");
    expect(container.querySelector(".chart-panel__annotation")).not.toBeInTheDocument();
  });

  it("renders no annotation element when annotation is blank/whitespace-only", async () => {
    const { container } = renderChartRenderer("   ");
    await screen.findByTestId("echarts");
    expect(container.querySelector(".chart-panel__annotation")).not.toBeInTheDocument();
  });

  it("renders no annotation element when annotation is null", async () => {
    const { container } = renderChartRenderer(null);
    await screen.findByTestId("echarts");
    expect(container.querySelector(".chart-panel__annotation")).not.toBeInTheDocument();
  });

  it("exposes the full annotation text via title for clamped/long text", async () => {
    const long = "Preliminary data — subject to revision ".repeat(10).trim();
    const { container } = renderChartRenderer(`  ${long}  `);
    await screen.findByTestId("echarts");
    const el = container.querySelector(".chart-panel__annotation");
    expect(el).toHaveTextContent(long);
    expect(el).toHaveAttribute("title", long);
  });
});
