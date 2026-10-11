// HEL-1305 -- the History view looks up the series' x field (`series.x`) in the Output's schema.
import { render } from "@testing-library/react";

import type { HistoryPoint } from "../../../panels/history/outputHistoryService";
import type { Output } from "../../types/output";
import { HistoryChart } from "./HistoryChart";

const captured: Array<{ fieldTypes?: Record<string, string> | null }> = [];
jest.mock("../../../panels/ui/renderers/ChartRenderer", () => ({
  ChartRenderer: (props: { fieldTypes?: Record<string, string> | null }) => {
    captured.push(props);
    return <div data-testid="history-chart-renderer" />;
  },
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
        ["2026-10-01", 1],
        ["2026-10-09", 2],
      ],
    },
  },
};

const output: Output = {
  id: "o1",
  pipelineId: "p",
  ownerId: "u",
  name: "n",
  kind: "chart",
  config: { chartType: "line", fieldMapping: { xAxis: "day", yAxis: "failures" } },
  schema: [
    { name: "day", type: "timestamp" },
    { name: "failures", type: "integer" },
  ],
  createdAt: "",
  updatedAt: "",
};

describe("HistoryChart field types (HEL-1305)", () => {
  it("hands the renderer the Output's schema types so a timestamp series.x is a time axis", () => {
    render(<HistoryChart output={output} selected={selected} comparison={null} />);
    expect(captured.at(-1)?.fieldTypes).toEqual({ day: "timestamp", failures: "integer" });
  });
});
