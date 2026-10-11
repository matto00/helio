// HEL-1305 -- the dashboard render path hands the chart the Output's declared field types, so a
// timestamp x field plots on a time axis. The captured types are fed to the real option builder.
import { render } from "@testing-library/react";

import { ChartOutputPanel } from "./ChartOutputPanel";
import { resetHistoryCache } from "../history/outputHistoryCache";
import { build, SERIES_HEADERS, xAxisOf } from "./timeAxisTestSupport";

jest.mock("../history/outputHistoryService", () => ({
  fetchOutputHistory: jest.fn(),
  fetchPublicOutputHistory: jest.fn(),
}));
jest.mock("../services/pipelineRunFanout", () => ({
  subscribeToPipelineTerminal: jest.fn(() => jest.fn()),
}));

type Captured = {
  fieldTypes?: Record<string, string> | null;
  chartAggregate?: { groupBy?: string } | null;
};
const captured: Captured[] = [];
jest.mock("./renderers/ChartRenderer", () => ({
  ChartRenderer: (props: Captured) => {
    captured.push(props);
    return <div data-testid="chart" />;
  },
}));

const APPEARANCE = { background: "#fff", color: "#000", transparency: 1 };
const rows = [
  ["2026-10-09", "9", "e"],
  ["2026-10-01", "1", "e"],
];

function renderPanel(
  config: Record<string, unknown>,
  schema?: Array<{ name: string; type: string }>,
) {
  return render(
    <ChartOutputPanel
      panelId="p1"
      outputId="o1"
      config={config}
      schema={schema}
      appearance={APPEARANCE}
      rawRows={rows}
      headers={SERIES_HEADERS}
      records={rows.map(([day, amount]) => ({ day, amount: Number(amount) }))}
      filterActive={false}
      rowsTruncated={false}
    />,
  );
}

beforeEach(() => {
  captured.length = 0;
  resetHistoryCache();
});

describe("ChartOutputPanel field types (HEL-1305)", () => {
  const config = { chartType: "line", fieldMapping: { xAxis: "day", yAxis: "amount" } };

  it("a timestamp-typed x in the Output schema yields a time axis", () => {
    renderPanel(config, [
      { name: "day", type: "timestamp" },
      { name: "amount", type: "integer" },
    ]);
    const fieldTypes = captured.at(-1)?.fieldTypes;
    expect(fieldTypes).toEqual({ day: "timestamp", amount: "integer" });
    const option = build("line", {
      rows,
      headers: SERIES_HEADERS,
      fieldMapping: config.fieldMapping,
      fieldTypes,
    });
    expect(xAxisOf(option).type).toBe("time");
  });

  it("an Output with no schema leaves the field types absent (category axis)", () => {
    renderPanel(config, []);
    expect(captured.at(-1)?.fieldTypes ?? null).toBeNull();
  });

  it("an aggregated chart carries its groupBy field for the time-axis decision", () => {
    renderPanel(
      {
        chartType: "bar",
        fieldMapping: { xAxis: "day", yAxis: "amount" },
        aggregation: { groupBy: "day", agg: "sum", yField: "amount" },
      },
      [{ name: "day", type: "timestamp" }],
    );
    expect(captured.at(-1)?.chartAggregate?.groupBy).toBe("day");
  });
});
