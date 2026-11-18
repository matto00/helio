import { render, screen } from "@testing-library/react";

import { OutputPreviewPane } from "./OutputPreviewPane";

describe("OutputPreviewPane insight (HEL-1740)", () => {
  it.each([
    ["rows", { rows: [{ region: "Bound value" }] }],
    ["no rows", { rows: [] }],
  ])("shows the not-yet-rendered state and never the rows (%s)", (_name, rows) => {
    render(
      <OutputPreviewPane
        kind="insight"
        rows={rows as never}
        loading={false}
        chartType="bar"
        chartFieldMapping={{}}
        referenceMarks={{ lines: [], bands: [] } as never}
      />,
    );
    expect(screen.getByText("Not yet rendered")).toBeInTheDocument();
    expect(screen.queryByText("Bound value")).toBeNull();
    expect(screen.queryByText("No preview rows yet.")).toBeNull();
  });
});
