// F-035 — the live preview must reflect the wizard's actual current state:
// a bound DataType, the metric label/unit, and the chosen chart type — and
// must never show a "bind a data type" hint once one has actually been
// bound. Covers every type but image (which still renders "for real" via
// PanelContent → ImageRenderer, unaffected by this fix).

import { render, screen, within } from "@testing-library/react";

import type { PanelContentProps } from "./PanelContent";
import { PanelCreationPreview } from "./PanelCreationPreview";

// PanelContent pulls in ECharts (via ChartRenderer/ChartPanel), which Jest
// can't parse without a real DOM/canvas — mocked here exactly as
// PanelCreationModal.test.tsx already does, since PanelContent is imported
// (and its module graph loaded) regardless of which branch actually renders.
jest.mock("./PanelContent", () => ({
  PanelContent: ({ panel }: PanelContentProps) => (
    <div data-testid="panel-content" data-panel-type={panel.type} />
  ),
}));

describe("PanelCreationPreview — summary line (non-image types)", () => {
  it("shows 'No data type selected yet' before any DataType is bound", () => {
    render(<PanelCreationPreview type="metric" title="Revenue" typeConfig={null} />);
    const summary = screen.getByTestId("panel-creation-preview-summary");
    expect(within(summary).getByText(/No data type selected yet/)).toBeInTheDocument();
  });

  it("shows the bound DataType's name once one is selected — never the 'no data type' hint", () => {
    render(
      <PanelCreationPreview
        type="metric"
        title="Revenue"
        typeConfig={null}
        dataTypeId="dt-1"
        dataTypeName="Revenue Data"
      />,
    );
    const summary = screen.getByTestId("panel-creation-preview-summary");
    expect(within(summary).getByText(/Bound to Revenue Data/)).toBeInTheDocument();
    expect(within(summary).queryByText(/No data type selected yet/)).not.toBeInTheDocument();
  });

  it("reflects the metric value label and unit", () => {
    render(
      <PanelCreationPreview
        type="metric"
        title="Revenue"
        typeConfig={{ type: "metric", valueLabel: "Revenue", unit: "$" }}
        dataTypeId="dt-1"
        dataTypeName="Sales"
      />,
    );
    const summary = screen.getByTestId("panel-creation-preview-summary");
    expect(within(summary).getByText(/Revenue \(\$\)/)).toBeInTheDocument();
  });

  it("reflects the selected chart type", () => {
    render(
      <PanelCreationPreview
        type="chart"
        title="Trend"
        typeConfig={{ type: "chart", chartType: "line" }}
        dataTypeId="dt-1"
        dataTypeName="Revenue by Region"
      />,
    );
    const summary = screen.getByTestId("panel-creation-preview-summary");
    expect(summary.textContent).toBe("Chart · Line · Bound to Revenue by Region");
  });

  it("text/markdown never show 'No data type selected yet' — that's a legitimate unbound state for them", () => {
    render(<PanelCreationPreview type="text" title="Notes" typeConfig={null} />);
    const summary = screen.getByTestId("panel-creation-preview-summary");
    expect(
      within(summary).getByText(/Content is added after creating this panel/),
    ).toBeInTheDocument();
    expect(within(summary).queryByText(/No data type selected yet/)).not.toBeInTheDocument();
  });

  it("never renders the renderer-driven 'bind a data type' placeholder copy for a bound collection/timeline", () => {
    render(
      <PanelCreationPreview
        type="collection"
        title="Accounts"
        typeConfig={null}
        dataTypeId="dt-1"
        dataTypeName="Accounts"
      />,
    );
    expect(screen.queryByText(/Bind a data type to populate/)).not.toBeInTheDocument();
  });
});

describe("PanelCreationPreview — image type still renders for real", () => {
  it("renders PanelContent (not the static summary) for image", () => {
    render(<PanelCreationPreview type="image" title="Banner" typeConfig={null} />);
    expect(screen.queryByTestId("panel-creation-preview-summary")).not.toBeInTheDocument();
    expect(screen.getByTestId("panel-content")).toHaveAttribute("data-panel-type", "image");
  });
});

describe("PanelCreationPreview — title", () => {
  it("shows the trimmed title", () => {
    render(<PanelCreationPreview type="metric" title="  Revenue  " typeConfig={null} />);
    expect(screen.getByText("Revenue")).toBeInTheDocument();
  });

  it("shows the 'Untitled' placeholder for a blank title", () => {
    render(<PanelCreationPreview type="metric" title="" typeConfig={null} />);
    expect(screen.getByText("Untitled")).toBeInTheDocument();
  });
});
