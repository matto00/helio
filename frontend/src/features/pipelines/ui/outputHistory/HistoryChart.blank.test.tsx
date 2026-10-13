// HEL-1424 -- a grouped history series stores a null group as "null"; it is shown as "(blank)" in
// BOTH the selected rows and the "vs" comparison overlay so the two stay aligned.
import { render } from "@testing-library/react";

import type { HistoryPoint } from "../../../panels/history/outputHistoryService";
import type { Output } from "../../types/output";
import { HistoryChart } from "./HistoryChart";

const captured: Array<{ rawRows?: string[][]; overlay?: { points: [unknown, number | null][] } }> =
  [];
jest.mock("../../../panels/ui/renderers/ChartRenderer", () => ({
  ChartRenderer: (props: { rawRows?: string[][] }) => {
    captured.push(props);
    return <div data-testid="history-chart-renderer" />;
  },
}));

function point(
  id: string,
  mode: "grouped" | "rows",
  points: [unknown, number | null][],
): HistoryPoint {
  return {
    id,
    hasPayload: false,
    capturedAt: "2026-10-05T14:02:00Z",
    runId: "run-" + id,
    triggerSource: "manual",
    rowCount: points.length,
    summary: {
      v: 1,
      series: {
        mode,
        x: "team",
        y: "amount",
        agg: mode === "grouped" ? "sum" : null,
        downsampled: false,
        totalPoints: points.length,
        points,
      },
    },
  };
}

const output: Output = {
  id: "o1",
  pipelineId: "p",
  ownerId: "u",
  name: "n",
  kind: "chart",
  config: { chartType: "bar", fieldMapping: { xAxis: "team", yAxis: "amount" } },
  schema: [
    { name: "team", type: "string" },
    { name: "amount", type: "integer" },
  ],
  createdAt: "",
  updatedAt: "",
};

beforeEach(() => {
  captured.length = 0;
});

describe("HistoryChart blank category (HEL-1424)", () => {
  it("relabels a stored 'null' group in the selected rows and the vs comparison points", () => {
    const selected = point("a", "grouped", [
      ["east", 5],
      ["null", 3],
    ]);
    const comparison = point("b", "grouped", [
      ["east", 4],
      ["null", 2],
    ]);
    render(<HistoryChart output={output} selected={selected} comparison={comparison} />);
    const props = captured.at(-1)!;
    expect(props.rawRows).toEqual([
      ["east", "5"],
      ["(blank)", "3"],
    ]);
    expect(props.overlay?.points).toEqual([
      ["east", 4],
      ["(blank)", 2],
    ]);
  });

  it("leaves a rows-mode series untouched", () => {
    const selected = point("a", "rows", [
      ["null", 5],
      ["x", 3],
    ]);
    render(<HistoryChart output={output} selected={selected} comparison={null} />);
    expect(captured.at(-1)!.rawRows).toEqual([
      ["null", "5"],
      ["x", "3"],
    ]);
  });
});
