import { render, screen } from "@testing-library/react";

import type { HistoryPoint } from "../../../panels/history/outputHistoryService";
import type { Output } from "../../types/output";
import { HistoryChart } from "./HistoryChart";

// The chart itself is irrelevant here; only whether the History view draws one for the type.
jest.mock("../../../panels/ui/renderers/ChartRenderer", () => ({
  ChartRenderer: () => <div data-testid="history-chart-renderer" />,
}));

const selected: HistoryPoint = {
  id: "p1",
  hasPayload: false,
  capturedAt: "2026-10-05T14:02:00Z",
  runId: "run-1",
  triggerSource: "manual",
  rowCount: 2,
  summary: {
    v: 1,
    series: {
      mode: "rows",
      x: "day",
      y: "failures",
      agg: null,
      downsampled: false,
      totalPoints: 2,
      points: [
        ["Mon", 1],
        ["Tue", 2],
      ],
    },
  },
};

function output(chartType: string): Output {
  return {
    id: "o1",
    pipelineId: "p",
    ownerId: "u",
    name: "n",
    kind: "chart",
    config: { chartType, fieldMapping: { xAxis: "day", yAxis: "failures" } },
    schema: [],
    createdAt: "",
    updatedAt: "",
  };
}

describe("HistoryChart for heatmap and histogram Outputs (HEL-1311)", () => {
  it.each(["heatmap", "histogram"])("shows a muted note instead of a %s chart", (type) => {
    render(<HistoryChart output={output(type)} selected={selected} comparison={null} />);
    expect(
      screen.getByText("A history chart isn't drawn for heatmap or histogram Outputs."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("history-chart-renderer")).not.toBeInTheDocument();
  });

  it("still draws a bar chart from the stored series", () => {
    render(<HistoryChart output={output("bar")} selected={selected} comparison={null} />);
    expect(screen.getByTestId("history-chart-renderer")).toBeInTheDocument();
  });
});
