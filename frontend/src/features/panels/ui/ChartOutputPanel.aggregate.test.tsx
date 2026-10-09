import { render, screen } from "@testing-library/react";

import { ChartOutputPanel } from "./ChartOutputPanel";
import { OutputPreviewPane } from "../../pipelines/ui/outputEditor/OutputPreviewPane";
import { resolvePanelChartType } from "./resolvePanelChartType";
import { defaultChartAppearance, defaultPanelAppearance } from "../../../theme/appearance";
import type { GroupedAggregate } from "../../../utils/aggregate";
import type { ChartAggregationSpec, ChartOverlay } from "../history/chartOverlay";
import type { PanelAppearance } from "../types/panel";
import * as service from "../history/outputHistoryService";
import { resetHistoryCache } from "../history/outputHistoryCache";
import { makeHistory } from "../history/historyFixtures";

jest.mock("../history/outputHistoryService", () => ({
  fetchOutputHistory: jest.fn(),
  fetchPublicOutputHistory: jest.fn(),
}));
jest.mock("../services/pipelineRunFanout", () => ({
  subscribeToPipelineTerminal: jest.fn(() => jest.fn()),
}));

interface Captured {
  appearance?: PanelAppearance;
  chartAggregate?: GroupedAggregate | null;
  aggregationSpec?: ChartAggregationSpec | null;
  overlay?: ChartOverlay | null;
}
const captured: Captured[] = [];
jest.mock("./renderers/ChartRenderer", () => ({
  ChartRenderer: (props: Captured) => {
    captured.push(props);
    return <div data-testid="chart">{props.overlay ? props.overlay.label : "no-overlay"}</div>;
  },
}));

const fetchHistory = jest.mocked(service.fetchOutputHistory);

// Includes a null group cell: `String(null)` = "null" in the preview, the dashboard and the server.
const RECORDS: Record<string, unknown>[] = [
  { region: "east", amount: 10 },
  { region: "east", amount: 5 },
  { region: "west", amount: 7 },
  { region: null, amount: 2 },
];
const ROWS = RECORDS.map((r) => Object.values(r).map((v) => (v == null ? "" : String(v))));
const HEADERS = ["region", "amount"];
const AGG = { groupBy: "region", agg: "sum", yField: "amount" };
const BAR_CONFIG = {
  chartType: "bar",
  fieldMapping: { xAxis: "region", yAxis: "amount" },
  aggregation: AGG,
};

const APPEARANCE: PanelAppearance = { background: "#fff", color: "#000", transparency: 1 };

function renderPanel(config: Record<string, unknown>, extra: Partial<PanelAppearance> = {}) {
  return render(
    <ChartOutputPanel
      panelId="p1"
      outputId="o1"
      config={config}
      appearance={{ ...APPEARANCE, ...extra }}
      rawRows={ROWS}
      headers={HEADERS}
      records={RECORDS}
      filterActive={false}
      rowsTruncated={false}
    />,
  );
}

beforeEach(() => {
  captured.length = 0;
  resetHistoryCache();
  fetchHistory.mockReset();
});

describe("ChartOutputPanel aggregation (HEL-1351)", () => {
  it("groups the loaded records by groupBy and names the series <agg>(<yField>)", () => {
    renderPanel(BAR_CONFIG);
    const last = captured.at(-1)!;
    expect(last.chartAggregate).toEqual({
      categories: ["east", "null", "west"],
      values: [15, 2, 7],
      seriesName: "sum(amount)",
    });
    expect(last.aggregationSpec).toEqual({ ...AGG, groupHasNull: true });
  });

  it("renders the SAME aggregate as the editor preview on the same records (C2)", () => {
    renderPanel(BAR_CONFIG);
    const dashboard = captured.at(-1)!.chartAggregate;
    captured.length = 0;
    render(
      <OutputPreviewPane
        kind="chart"
        rows={{ columns: HEADERS, rows: RECORDS } as never}
        loading={false}
        chartType="bar"
        chartFieldMapping={{ xAxis: "region", yAxis: "amount" }}
        chartGroupBy="region"
        chartAggFn="sum"
        chartYField="amount"
      />,
    );
    expect(captured.at(-1)!.chartAggregate).toEqual(dashboard);
  });

  it("carries groupHasNull from strict-null records only, never from the stringified rawRows (HEL-1408 D10a)", () => {
    // rawRows stringify null to "" -- a record set with "" (not null) must NOT flag a null group.
    const emptyStringRecords = RECORDS.map((r) => (r.region === null ? { ...r, region: "" } : r));
    render(
      <ChartOutputPanel
        panelId="p1"
        outputId="o1"
        config={BAR_CONFIG}
        appearance={APPEARANCE}
        rawRows={ROWS}
        headers={HEADERS}
        records={emptyStringRecords}
        filterActive={false}
        rowsTruncated={false}
      />,
    );
    expect(captured.at(-1)!.aggregationSpec).toEqual({ ...AGG, groupHasNull: false });
    // The grouping itself is untouched: "" is its own (first-sorted) group, null stays "null".
    expect(captured.at(-1)!.chartAggregate!.categories).toEqual(["", "east", "west"]);
  });

  it("an absent group key (undefined, no null) does not set groupHasNull (strict === null)", () => {
    const absentKeyRecords: Record<string, unknown>[] = [
      { region: "east", amount: 10 },
      { amount: 2 },
    ];
    render(
      <ChartOutputPanel
        panelId="p1"
        outputId="o1"
        config={BAR_CONFIG}
        appearance={APPEARANCE}
        rawRows={[
          ["east", "10"],
          ["", "2"],
        ]}
        headers={HEADERS}
        records={absentKeyRecords}
        filterActive={false}
        rowsTruncated={false}
      />,
    );
    expect(captured.at(-1)!.aggregationSpec).toEqual({ ...AGG, groupHasNull: false });
    expect(captured.at(-1)!.chartAggregate!.categories).toEqual(["east", "undefined"]);
  });

  it("does not group a scatter Output, nor a panel whose resolved type is scatter", () => {
    renderPanel({ ...BAR_CONFIG, chartType: "scatter" });
    expect(captured.at(-1)!.chartAggregate).toBeNull();
    expect(captured.at(-1)!.aggregationSpec).toBeNull();
    captured.length = 0;
    renderPanel(BAR_CONFIG, { chart: { ...defaultChartAppearance, chartType: "scatter" } });
    expect(captured.at(-1)!.chartAggregate).toBeNull();
    expect(captured.at(-1)!.aggregationSpec).toBeNull();
  });

  it("leaves a non-aggregated Output on raw rows", () => {
    renderPanel({ chartType: "bar", fieldMapping: { xAxis: "region", yAxis: "amount" } });
    expect(captured.at(-1)!.chartAggregate).toBeNull();
  });

  it("overlays the grouped baseline on a complete, unfiltered aggregated panel", async () => {
    const h = makeHistory();
    fetchHistory.mockResolvedValue({
      ...h,
      baseline: {
        ...h.baseline!,
        series: {
          mode: "grouped",
          x: "region",
          y: "amount",
          agg: "sum",
          points: [
            ["east", 12],
            ["west", 6],
          ],
          totalPoints: 2,
          downsampled: false,
        },
      },
    });
    renderPanel({ ...BAR_CONFIG, compare: "7d" });
    expect(await screen.findByText("vs 7d")).toBeInTheDocument();
    expect(captured.at(-1)!.overlay?.points).toEqual([
      ["east", 12],
      ["west", 6],
    ]);
  });

  it("draws no overlay when the aggregated panel's rows are truncated (C1)", async () => {
    const h = makeHistory();
    fetchHistory.mockResolvedValue({
      ...h,
      baseline: {
        ...h.baseline!,
        series: {
          mode: "grouped",
          x: "region",
          y: "amount",
          agg: "sum",
          points: [["east", 12]],
          totalPoints: 1,
          downsampled: false,
        },
      },
    });
    render(
      <ChartOutputPanel
        panelId="p1"
        outputId="o1"
        config={{ ...BAR_CONFIG, compare: "7d" }}
        appearance={APPEARANCE}
        rawRows={ROWS}
        headers={HEADERS}
        records={RECORDS}
        filterActive={false}
        rowsTruncated
      />,
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(await screen.findByText("no-overlay")).toBeInTheDocument();
  });

  it("falls back to raw rows (and no grouped overlay) when no records are supplied", () => {
    render(
      <ChartOutputPanel
        panelId="p1"
        outputId="o1"
        config={BAR_CONFIG}
        appearance={APPEARANCE}
        rawRows={ROWS}
        headers={HEADERS}
        filterActive={false}
        rowsTruncated={false}
      />,
    );
    expect(captured.at(-1)!.chartAggregate).toBeNull();
    expect(captured.at(-1)!.overlay).toBeNull();
  });
});

describe("chart type resolution (HEL-1351 D7)", () => {
  it("uses the Output's chartType when the panel stores none", () => {
    renderPanel({ ...BAR_CONFIG, aggregation: null });
    expect(captured.at(-1)!.appearance?.chart?.chartType).toBe("bar");
  });

  it("lets an explicitly stored panel chartType win", () => {
    const appearance = { chart: { ...defaultChartAppearance, chartType: "line" as const } };
    renderPanel({ ...BAR_CONFIG, aggregation: null }, appearance);
    expect(captured.at(-1)!.appearance?.chart?.chartType).toBe("line");
  });

  it("passes appearance through untouched when the resolved type is the line default", () => {
    renderPanel({ chartType: "line" });
    expect(captured.at(-1)!.appearance).toEqual(APPEARANCE);
  });

  it("resolvePanelChartType: stored > Output > line, ignoring unknown Output types", () => {
    const stored = { ...defaultChartAppearance, chartType: "pie" as const };
    expect(resolvePanelChartType(stored, { chartType: "bar" })).toBe("pie");
    expect(resolvePanelChartType(undefined, { chartType: "bar" })).toBe("bar");
    const noType = { ...defaultChartAppearance, chartType: undefined };
    expect(resolvePanelChartType(noType, { chartType: "scatter" })).toBe("scatter");
    expect(resolvePanelChartType(undefined, {})).toBe("line");
    expect(resolvePanelChartType(undefined, { chartType: "radar" })).toBe("line");
  });

  it("never mutates the stored appearance object", () => {
    const appearance = { ...defaultPanelAppearance };
    const before = JSON.stringify(appearance);
    render(
      <ChartOutputPanel
        panelId="p1"
        outputId="o1"
        config={{ chartType: "bar" }}
        appearance={appearance}
        rawRows={ROWS}
        headers={HEADERS}
        records={RECORDS}
        filterActive={false}
        rowsTruncated={false}
      />,
    );
    expect(JSON.stringify(appearance)).toBe(before);
  });
});
