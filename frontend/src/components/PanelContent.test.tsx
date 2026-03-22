import { render, screen } from "@testing-library/react";

import { PanelContent } from "./PanelContent";

describe("PanelContent", () => {
  it("renders the metric placeholder for type metric", () => {
    render(<PanelContent type="metric" />);
    expect(screen.getByText("--")).toBeInTheDocument();
    expect(screen.getByText("No data")).toBeInTheDocument();
  });

  it("renders bar elements for type chart", () => {
    const { container } = render(<PanelContent type="chart" />);
    const bars = container.querySelectorAll(".panel-content__bar");
    expect(bars.length).toBeGreaterThan(0);
  });

  it("renders placeholder lines for type text", () => {
    const { container } = render(<PanelContent type="text" />);
    const lines = container.querySelectorAll(".panel-content__text-line");
    expect(lines.length).toBeGreaterThan(0);
  });

  it("renders a table element for type table", () => {
    const { container } = render(<PanelContent type="table" />);
    expect(container.querySelector("table")).toBeInTheDocument();
  });
});
