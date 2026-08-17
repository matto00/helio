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

describe("ChartRenderer — annotation footnote (HEL-318)", () => {
  it("renders the annotation beneath the chart when set", () => {
    renderChartRenderer("Source: Bureau of Labor Statistics");
    expect(screen.getByTestId("echarts")).toBeInTheDocument();
    expect(screen.getByText("Source: Bureau of Labor Statistics")).toBeInTheDocument();
  });

  it("renders no annotation element when annotation is absent", () => {
    const { container } = renderChartRenderer();
    expect(container.querySelector(".chart-panel__annotation")).not.toBeInTheDocument();
  });

  it("renders no annotation element when annotation is blank/whitespace-only", () => {
    const { container } = renderChartRenderer("   ");
    expect(container.querySelector(".chart-panel__annotation")).not.toBeInTheDocument();
  });

  it("renders no annotation element when annotation is null", () => {
    const { container } = renderChartRenderer(null);
    expect(container.querySelector(".chart-panel__annotation")).not.toBeInTheDocument();
  });

  it("exposes the full annotation text via title for clamped/long text", () => {
    const long = "Preliminary data — subject to revision ".repeat(10).trim();
    const { container } = renderChartRenderer(`  ${long}  `);
    const el = container.querySelector(".chart-panel__annotation");
    expect(el).toHaveTextContent(long);
    expect(el).toHaveAttribute("title", long);
  });
});
