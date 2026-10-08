import { screen, waitFor } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import { PanelContent, type PanelContentProps } from "./PanelContent";
import { makeOutputPanel } from "../../../test/panelFixtures";
import { getOutputById as getOutputByIdRequest } from "../../pipelines/services/outputService";
import * as service from "../history/outputHistoryService";
import { resetHistoryCache } from "../history/outputHistoryCache";
import { makeHistory } from "../history/historyFixtures";
import type { Output } from "../../pipelines/types/output";

// HEL-1358 — the on-chart truncation note, through the REAL ChartRenderer (only echarts is mocked).

jest.mock("echarts-for-react/esm/core", () => ({
  __esModule: true,
  default: ({ option }: { option: unknown }) => (
    <div data-testid="echarts" data-option={JSON.stringify(option)} />
  ),
}));
jest.mock("./echartsCore", () => ({ __esModule: true, default: {} }));
jest.mock("../../pipelines/services/outputService", () => ({ getOutputById: jest.fn() }));
jest.mock("../history/outputHistoryService", () => ({
  fetchOutputHistory: jest.fn(),
  fetchPublicOutputHistory: jest.fn(),
}));
jest.mock("../services/pipelineRunFanout", () => ({
  subscribeToPipelineTerminal: jest.fn(() => jest.fn()),
}));

const getOutputById = jest.mocked(getOutputByIdRequest);
const fetchHistory = jest.mocked(service.fetchOutputHistory);

const n = (v: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(v);
const NOTE = `Based on the first ${n(2)} of ${n(1234)} rows.`;

function makeOutput(config: Record<string, unknown>): Output {
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

const BASE_CONFIG = { chartType: "line", fieldMapping: { xAxis: "day", yAxis: "amount" } };
const ROWS = {
  rawRows: [
    ["Mon", "5"],
    ["Tue", "6"],
  ],
  headers: ["day", "amount"],
};
const PANEL = makeOutputPanel();

function renderChart(props: Partial<PanelContentProps> = {}) {
  return renderWithStore(
    <PanelContent crossFilterMode="none" panel={PANEL} {...ROWS} {...props} />,
  );
}

beforeEach(() => {
  resetHistoryCache();
  getOutputById.mockReset().mockResolvedValue(makeOutput(BASE_CONFIG));
  const h = makeHistory();
  fetchHistory.mockReset().mockResolvedValue({
    ...h,
    baseline: {
      ...h.baseline!,
      series: {
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
      },
    },
  });
});

describe("chart truncation note (HEL-1358)", () => {
  it("names both counts when the loaded rows are fewer than the total", async () => {
    renderChart({ rowsTruncated: true, totalRowCount: 1234 });
    expect(await screen.findByText(NOTE)).toBeInTheDocument();
  });

  it("says 'matching rows' under a viewer filter", async () => {
    renderChart({ rowsTruncated: true, totalRowCount: 1234, viewerFilterActive: true });
    expect(
      await screen.findByText(`Based on the first ${n(2)} of ${n(1234)} matching rows.`),
    ).toBeInTheDocument();
  });

  it("renders nothing when every row is loaded", async () => {
    renderChart({ rowsTruncated: false, totalRowCount: 2 });
    await screen.findByTestId("echarts");
    expect(screen.queryByText(/Based on the first/)).toBeNull();
  });

  it("renders nothing when the total is unknown or truncation is unknown", async () => {
    const { unmount } = renderChart({ rowsTruncated: true, totalRowCount: undefined });
    await screen.findByTestId("echarts");
    expect(screen.queryByText(/Based on the first/)).toBeNull();
    unmount();
    renderChart({ rowsTruncated: undefined, totalRowCount: 1234 });
    await screen.findByTestId("echarts");
    expect(screen.queryByText(/Based on the first/)).toBeNull();
  });

  it("shows the note for an aggregated chart too", async () => {
    getOutputById.mockResolvedValue(
      makeOutput({ ...BASE_CONFIG, aggregation: { groupBy: "day", agg: "sum", yField: "amount" } }),
    );
    renderChart({
      rowsTruncated: true,
      totalRowCount: 1234,
      paginationRows: [
        { day: "Mon", amount: 5 },
        { day: "Tue", amount: 6 },
      ],
    });
    expect(await screen.findByText(NOTE)).toBeInTheDocument();
  });

  it("orders annotation, truncation note and cross-filter disclosure (D3a)", async () => {
    getOutputById.mockResolvedValue(makeOutput({ ...BASE_CONFIG, annotation: "Source: ERP" }));
    renderWithStore(
      <PanelContent
        crossFilterMode="client-fallback"
        panel={PANEL}
        {...ROWS}
        rowsTruncated
        totalRowCount={1234}
      />,
      {
        panels: {
          items: [],
          crossFilter: { panelId: "other", dimension: "day", value: "Mon", series: "s" },
        },
      },
    );
    const note = await screen.findByText(NOTE);
    const annotation = screen.getByText("Source: ERP");
    const disclosure = await screen.findByText(/loaded rows match/);
    const follows = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(annotation, note)).toBe(true);
    expect(follows(note, disclosure)).toBe(true);
  });

  it("leaves the vs overlay hidden for a truncated chart that has config.compare (AC5)", async () => {
    getOutputById.mockResolvedValue(makeOutput({ ...BASE_CONFIG, compare: "7d" }));
    const { unmount } = renderChart({ rowsTruncated: false, totalRowCount: 2 });
    // positive control: a complete chart DOES draw the overlay
    await waitFor(() =>
      expect(screen.getByTestId("echarts").getAttribute("data-option")).toContain("vs 7d"),
    );
    unmount();
    resetHistoryCache();
    renderChart({ rowsTruncated: true, totalRowCount: 1234 });
    expect(await screen.findByText(NOTE)).toBeInTheDocument();
    await waitFor(() => expect(fetchHistory).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("echarts").getAttribute("data-option")).not.toContain("vs 7d");
  });
});
