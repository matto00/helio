import { act, screen, waitFor } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import { PanelContent, type PanelContentProps } from "./PanelContent";
import { makeOutputPanel } from "../../../test/panelFixtures";
import { getOutputById as getOutputByIdRequest } from "../../pipelines/services/outputService";
import * as service from "../history/outputHistoryService";
import { resetHistoryCache } from "../history/outputHistoryCache";
import { makeHistory } from "../history/historyFixtures";
import type { HistorySeries } from "../history/outputHistoryService";
import type { ChartOverlay } from "../history/chartOverlay";
import type { Output } from "../../pipelines/types/output";

jest.mock("../../pipelines/services/outputService", () => ({ getOutputById: jest.fn() }));
jest.mock("../history/outputHistoryService", () => ({
  fetchOutputHistory: jest.fn(),
  fetchPublicOutputHistory: jest.fn(),
}));
jest.mock("../services/pipelineRunFanout", () => ({
  subscribeToPipelineTerminal: jest.fn(() => jest.fn()),
}));

// ChartPanel loads echarts lazily; capture the overlay `ChartRenderer` is handed instead.
const overlays: Array<ChartOverlay | null | undefined> = [];
jest.mock("./renderers/ChartRenderer", () => ({
  ChartRenderer: ({ overlay }: { overlay?: ChartOverlay | null }) => {
    overlays.push(overlay);
    return <div data-testid="chart">{overlay ? overlay.label : "no-overlay"}</div>;
  },
}));

const getOutputById = jest.mocked(getOutputByIdRequest);
const fetchHistory = jest.mocked(service.fetchOutputHistory);
const fetchPublicHistory = jest.mocked(service.fetchPublicOutputHistory);

const CHART_CONFIG = {
  chartType: "line",
  fieldMapping: { xAxis: "day", yAxis: "amount" },
  compare: "7d",
};

function makeOutput(config: Record<string, unknown> = CHART_CONFIG): Output {
  return {
    id: "output-1",
    pipelineId: "pipe-1",
    ownerId: "u1",
    name: "Revenue",
    kind: "chart",
    config,
    schema: [],
    createdAt: "",
    updatedAt: "",
  };
}

const SERIES: HistorySeries = {
  mode: "rows",
  x: "day",
  y: "amount",
  agg: null,
  points: [
    ["Mon", 3],
    ["Tue", 4],
  ],
  totalPoints: 2,
  downsampled: false,
};

function historyWithSeries(series: HistorySeries | null = SERIES) {
  const h = makeHistory();
  return { ...h, baseline: { ...h.baseline!, series } };
}

const ROWS = {
  rawRows: [
    ["Mon", "5"],
    ["Tue", "6"],
  ],
  headers: ["day", "amount"],
};
const PANEL = makeOutputPanel();

/** Waits for the history read AND its cache write to land, so a "no overlay" assertion is not
 *  satisfied merely because the history had not arrived yet. */
async function historySettled(calls = 1) {
  await waitFor(() => expect(fetchHistory).toHaveBeenCalledTimes(calls));
  await act(async () => {
    await fetchHistory.mock.results[calls - 1]?.value;
  });
}

function renderChart(props: Partial<PanelContentProps> = {}) {
  return renderWithStore(
    <PanelContent
      crossFilterMode="none"
      panel={PANEL}
      rowsTruncated={false}
      {...ROWS}
      {...props}
    />,
  );
}

beforeEach(() => {
  overlays.length = 0;
  resetHistoryCache();
  getOutputById.mockReset().mockResolvedValue(makeOutput());
  fetchHistory.mockReset().mockResolvedValue(historyWithSeries());
  fetchPublicHistory.mockReset().mockResolvedValue(historyWithSeries());
});

describe("PanelContent chart overlay (HEL-1277)", () => {
  it("hands the chart a labelled 'vs 7d' overlay from the baseline series", async () => {
    renderChart();
    expect(await screen.findByText("vs 7d")).toBeInTheDocument();
    expect(overlays.at(-1)?.points).toEqual(SERIES.points);
  });

  it("reads the public history route (no payload route exists) for a public viewer", async () => {
    renderChart({ historySource: { variant: "public", dashboardId: "d1", token: "tok" } });
    expect(await screen.findByText("vs 7d")).toBeInTheDocument();
    expect(fetchPublicHistory).toHaveBeenCalledWith("d1", PANEL.id, "tok");
    expect(fetchHistory).not.toHaveBeenCalled();
  });

  it("does not request history at all when the Output has no compare", async () => {
    getOutputById.mockResolvedValue(makeOutput({ ...CHART_CONFIG, compare: undefined }));
    renderChart();
    expect(await screen.findByText("no-overlay")).toBeInTheDocument();
    expect(fetchHistory).not.toHaveBeenCalled();
  });

  it("hides the overlay under a viewer filter", async () => {
    renderChart({ viewerFilterActive: true });
    await historySettled();
    expect(await screen.findByText("no-overlay")).toBeInTheDocument();
  });

  it("hides the overlay when a server cross-filter narrows the panel", async () => {
    renderChart({ crossFilterMode: "server" });
    await historySettled();
    expect(await screen.findByText("no-overlay")).toBeInTheDocument();
  });

  it("hides the overlay when more rows exist than were loaded, and when completeness is unknown", async () => {
    const { unmount } = renderChart({ rowsTruncated: true });
    await historySettled();
    expect(await screen.findByText("no-overlay")).toBeInTheDocument();
    unmount();
    resetHistoryCache();
    renderChart({ rowsTruncated: undefined });
    await historySettled(2);
    expect(await screen.findByText("no-overlay")).toBeInTheDocument();
  });

  it("hides the overlay when the stored series y differs from the panel's y", async () => {
    fetchHistory.mockResolvedValue(historyWithSeries({ ...SERIES, y: "cost" }));
    renderChart();
    await historySettled();
    expect(await screen.findByText("no-overlay")).toBeInTheDocument();
  });

  it("gives an aggregated chart Output no dashboard overlay (dashboards plot raw rows)", async () => {
    const aggregated = { ...CHART_CONFIG, aggregation: { groupBy: "day", agg: "sum" } };
    getOutputById.mockResolvedValue(makeOutput(aggregated));
    fetchHistory.mockResolvedValue(historyWithSeries({ ...SERIES, mode: "grouped", agg: "sum" }));
    renderChart();
    await historySettled();
    expect(await screen.findByText("no-overlay")).toBeInTheDocument();
  });
});
