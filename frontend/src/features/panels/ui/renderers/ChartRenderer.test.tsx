import { render, screen } from "@testing-library/react";

import { ChartRenderer } from "./ChartRenderer";

// The ECharts canvas is irrelevant to the annotation footnote under test; mock
// it so the renderer's own DOM (the annotation element) is what we assert on.
jest.mock("echarts-for-react", () => ({
  __esModule: true,
  default: () => <div data-testid="echarts" />,
}));

describe("ChartRenderer — annotation footnote (HEL-318)", () => {
  it("renders the annotation beneath the chart when set", () => {
    render(<ChartRenderer annotation="Source: Bureau of Labor Statistics" />);
    expect(screen.getByTestId("echarts")).toBeInTheDocument();
    expect(screen.getByText("Source: Bureau of Labor Statistics")).toBeInTheDocument();
  });

  it("renders no annotation element when annotation is absent", () => {
    const { container } = render(<ChartRenderer />);
    expect(container.querySelector(".chart-panel__annotation")).not.toBeInTheDocument();
  });

  it("renders no annotation element when annotation is blank/whitespace-only", () => {
    const { container } = render(<ChartRenderer annotation="   " />);
    expect(container.querySelector(".chart-panel__annotation")).not.toBeInTheDocument();
  });

  it("renders no annotation element when annotation is null", () => {
    const { container } = render(<ChartRenderer annotation={null} />);
    expect(container.querySelector(".chart-panel__annotation")).not.toBeInTheDocument();
  });

  it("exposes the full annotation text via title for clamped/long text", () => {
    const long = "Preliminary data — subject to revision ".repeat(10).trim();
    const { container } = render(<ChartRenderer annotation={`  ${long}  `} />);
    const el = container.querySelector(".chart-panel__annotation");
    expect(el).toHaveTextContent(long);
    expect(el).toHaveAttribute("title", long);
  });
});
