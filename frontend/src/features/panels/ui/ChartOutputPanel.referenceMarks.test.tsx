import { render } from "@testing-library/react";

import { ChartOutputPanel } from "./ChartOutputPanel";
import type { ReferenceMarks } from "../../../utils/referenceMarks";
import { resetHistoryCache } from "../history/outputHistoryCache";

jest.mock("../history/outputHistoryService", () => ({
  fetchOutputHistory: jest.fn(),
  fetchPublicOutputHistory: jest.fn(),
}));
jest.mock("../services/pipelineRunFanout", () => ({
  subscribeToPipelineTerminal: jest.fn(() => jest.fn()),
}));

const captured: Array<{ referenceMarks?: ReferenceMarks | null }> = [];
jest.mock("./renderers/ChartRenderer", () => ({
  ChartRenderer: (props: { referenceMarks?: ReferenceMarks | null }) => {
    captured.push(props);
    return <div data-testid="chart" />;
  },
}));

function renderPanel(config: Record<string, unknown>) {
  return render(
    <ChartOutputPanel
      panelId="p1"
      outputId="o1"
      config={config}
      appearance={{ background: "#fff", color: "#000", transparency: 1 }}
      rawRows={[["a", "1"]]}
      headers={["x", "y"]}
      records={[{ x: "a", y: 1 }]}
      filterActive={false}
      rowsTruncated={false}
    />,
  );
}

beforeEach(() => {
  captured.length = 0;
  resetHistoryCache();
});

describe("ChartOutputPanel reference marks (HEL-1306)", () => {
  it("hands the renderer the Output's sanitized lines and bands", () => {
    renderPanel({
      chartType: "bar",
      fieldMapping: { xAxis: "x", yAxis: "y" },
      referenceLines: [{ value: 95, label: "SLO", tone: "warning" }, { value: "bad" }],
      referenceBands: [{ from: 0, to: 50 }],
    });
    expect(captured.at(-1)?.referenceMarks).toEqual({
      lines: [{ value: 95, label: "SLO", tone: "warning" }],
      bands: [{ from: 0, to: 50 }],
    });
  });

  it("hands an empty set when the Output stores none, and a stable object across re-renders", () => {
    const config = { chartType: "line", fieldMapping: { xAxis: "x", yAxis: "y" } };
    const { rerender } = renderPanel(config);
    const first = captured.at(-1)?.referenceMarks;
    expect(first).toEqual({ lines: [], bands: [] });
    rerender(
      <ChartOutputPanel
        panelId="p1"
        outputId="o1"
        config={config}
        appearance={{ background: "#fff", color: "#000", transparency: 1 }}
        rawRows={[["a", "1"]]}
        headers={["x", "y"]}
        records={[{ x: "a", y: 1 }]}
        filterActive={false}
        rowsTruncated={false}
      />,
    );
    expect(captured.at(-1)?.referenceMarks).toBe(first);
  });
});
