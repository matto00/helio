// HEL-1632 (design.md D8): the live render matches the saved panel for the same rows. Records come from the REAL client
// evaluator over a fixture pipeline; (a) is the saved panel path (`OutputPanelContent` with its history mocked) and (b) the
// live render. Chart parity is compared on the props `ChartRenderer` receives (series, mapping, grouping, type), metric
// parity on the rendered value text.

import { render, screen, waitFor } from "@testing-library/react";

import { renderWithStore } from "../../../../test/renderWithStore";
import { defaultPanelAppearance } from "../../../../theme/appearance";
import { makeHistory } from "../../../panels/history/historyFixtures";
import { resetHistoryCache } from "../../../panels/history/outputHistoryCache";
import * as historyService from "../../../panels/history/outputHistoryService";
import { OutputPanelContent } from "../../../panels/ui/OutputPanelContent";
import { keyAggregate, recordsToPanelRows } from "../../../panels/ui/outputRenderInputs";
import { evaluatePipeline, int, type Frame } from "../../evaluator";
import { frameToRecords } from "../../state/liveOutput/frameRecords";
import type { Output } from "../../types/output";
import { LiveOutputRender } from "./LiveOutputRender";

jest.mock("../../../panels/history/outputHistoryService", () => ({
  fetchOutputHistory: jest.fn(),
  fetchPublicOutputHistory: jest.fn(),
}));
jest.mock("../../../panels/services/pipelineRunFanout", () => ({
  subscribeToPipelineTerminal: jest.fn(() => jest.fn()),
}));

const captured: Record<string, unknown>[] = [];
jest.mock("../../../panels/ui/renderers/ChartRenderer", () => ({
  ChartRenderer: (props: Record<string, unknown>) => {
    captured.push(props);
    return <div data-testid="chart" />;
  },
}));

const fetchHistory = jest.mocked(historyService.fetchOutputHistory);

const SCHEMA = [
  { name: "date", type: "string" },
  { name: "region", type: "string" },
  { name: "amount", type: "integer" },
  { name: "double_amount", type: "float" },
];

/** The real evaluator: a filter then a compute over a 6-row root. */
function evaluated(): Frame {
  const root: Frame = [
    { date: "2026-01-01", region: "east", amount: int(10) },
    { date: "2026-01-02", region: "west", amount: int(4) },
    { date: "2026-01-03", region: "east", amount: int(30) },
    { date: "2026-01-04", region: "west", amount: int(20) },
    { date: "2026-01-05", region: "north", amount: int(8) },
    { date: "2026-01-06", region: "east", amount: int(2) },
  ];
  const walk = evaluatePipeline(
    [
      {
        id: "f",
        kind: "filter",
        parentStepId: null,
        rootId: "r",
        position: 0,
        enabled: true,
        config: {
          combinator: "and",
          conditions: [{ field: "amount", operator: ">=", value: "5" }],
        },
      },
      {
        id: "c",
        kind: "compute",
        parentStepId: "f",
        rootId: "r",
        position: 0,
        enabled: true,
        config: { column: "double_amount", expression: "$amount * 2", type: "float" },
      },
    ],
    [{ rootId: "r", rows: root }],
  );
  const node = walk.nodes.get("c");
  if (node?.status !== "ok") throw new Error(`fixture did not evaluate: ${JSON.stringify(node)}`);
  return node.rows;
}

const output = (kind: string, config: Record<string, unknown>): Output => ({
  id: "o1",
  pipelineId: "p1",
  ownerId: "u",
  name: "Out",
  kind,
  config,
  schema: SCHEMA,
  createdAt: "",
  updatedAt: "",
});

function renderSaved(o: Output, records: Record<string, unknown>[]) {
  const { headers, rawRows } = recordsToPanelRows(records);
  return renderWithStore(
    <OutputPanelContent
      panelId="panel-1"
      outputId={o.id}
      appearance={defaultPanelAppearance}
      output={o}
      rawRows={rawRows}
      headers={headers}
      paginationRows={records}
      rowsTruncated={false}
      crossFilterMode="client-fallback"
      viewerFilterActive={false}
    />,
  );
}

const CHART_PROPS = [
  "appearance",
  "rawRows",
  "headers",
  "fieldMapping",
  "chartAggregate",
  "aggregationSpec",
  "chartOptions",
  "referenceMarks",
  "fieldTypes",
  "annotation",
] as const;
const chartProps = (p: Record<string, unknown>) =>
  Object.fromEntries(CHART_PROPS.map((k) => [k, p[k]]));

beforeEach(() => {
  captured.length = 0;
  resetHistoryCache();
  fetchHistory.mockReset();
  fetchHistory.mockRejectedValue(new Error("no history"));
});

describe("live render parity with the saved panel", () => {
  const records = frameToRecords(evaluated(), SCHEMA);

  it("fixture: the evaluator produced the filtered, computed rows in schema order", () => {
    expect(records).toHaveLength(4);
    expect(Object.keys(records[0])).toEqual(["date", "region", "amount", "double_amount"]);
    expect(records[0].double_amount).toBe(20);
  });

  const CHARTS: [string, Record<string, unknown>][] = [
    [
      "a line chart with an explicit x/y mapping",
      { chartType: "line", fieldMapping: { xAxis: "date", yAxis: "amount" } },
    ],
    [
      "an aggregated bar chart",
      {
        chartType: "bar",
        fieldMapping: { xAxis: "region", yAxis: "amount" },
        aggregation: { groupBy: "region", agg: "sum", yField: "amount" },
      },
    ],
  ];
  it.each(CHARTS)("%s plots the same series, mapping and grouping", async (_name, config) => {
    const o = output("chart", config);
    renderSaved(o, records);
    await screen.findByTestId("chart");
    const saved = chartProps(captured.at(-1)!);
    captured.length = 0;
    render(<LiveOutputRender kind="chart" config={config} schema={SCHEMA} records={records} />);
    const live = chartProps(captured.at(-1)!);
    expect(live).toEqual(saved);
    expect(live.rawRows).not.toBeNull();
    if (config.aggregation) {
      expect(live.chartAggregate).toMatchObject({ seriesName: "sum(amount)" });
    }
  });

  const METRIC = {
    fieldMapping: {},
    aggregation: { value: "amount", agg: "sum" },
    label: "Total",
  };
  const metricText = () =>
    document.querySelector(".panel-content__metric-value")?.textContent ?? null;

  it("shows the same metric value text and key aggregate", async () => {
    const o = output("metric", METRIC);
    const saved = renderSaved(o, records);
    await waitFor(() => expect(metricText()).toBe("68"));
    saved.unmount();
    render(<LiveOutputRender kind="metric" config={METRIC} schema={SCHEMA} records={records} />);
    expect(metricText()).toBe("68");
    expect(keyAggregate("metric", METRIC, records)).toEqual({ label: "SUM AMOUNT", value: 68 });
  });

  it("a metric whose saved history differs from the draft rows shows the draft headline live and the history one saved", async () => {
    fetchHistory.mockResolvedValue(
      makeHistory({
        compare: null,
        current: { capturedAt: "2026-10-05T10:00:00Z", rowCount: 10, value: 1204 },
      }),
    );
    const o = output("metric", METRIC);
    const saved = renderSaved(o, records);
    await waitFor(() => expect(metricText()).toBe("1204"));
    saved.unmount();
    render(<LiveOutputRender kind="metric" config={METRIC} schema={SCHEMA} records={records} />);
    expect(metricText()).toBe("68");
  });

  it("orders columns by the Output's schema, not by the key order of the rows (the documented divergence)", () => {
    const reversed: Frame = evaluated().map((row) =>
      Object.fromEntries(Object.entries(row).reverse()),
    );
    const config = { chartType: "line", fieldMapping: {} };
    const liveRecords = frameToRecords(reversed, SCHEMA);
    render(<LiveOutputRender kind="chart" config={config} schema={SCHEMA} records={liveRecords} />);
    // No x-axis mapping: the first column is the x axis, and live it is the schema's first field.
    expect(captured.at(-1)!.headers).toEqual(["date", "region", "amount", "double_amount"]);
    // The saved path takes whatever order the rows came in.
    const savedHeaders = recordsToPanelRows(
      reversed.map((r) => ({ ...r }) as Record<string, unknown>),
    ).headers;
    expect(savedHeaders?.[0]).toBe("double_amount");
  });
});
