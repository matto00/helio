import { screen, waitFor } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import { PanelContent, type PanelContentProps } from "./PanelContent";
import { makeOutputPanel } from "../../../test/panelFixtures";
import { getOutputById as getOutputByIdRequest } from "../../pipelines/services/outputService";
import * as service from "../history/outputHistoryService";
import { resetHistoryCache } from "../history/outputHistoryCache";
import { getPublishedComparison, resetComparisonStore } from "../history/metricComparisonStore";
import { METRIC_CONFIG, makeHistory, metricPoint, HEAD_AT } from "../history/historyFixtures";
import { buildViewerControlFilterOps } from "../state/viewerControlValues";
import type { Output } from "../../pipelines/types/output";

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
const fetchPublicHistory = jest.mocked(service.fetchPublicOutputHistory);

function makeOutput(config: Record<string, unknown> = METRIC_CONFIG): Output {
  return {
    id: "output-1",
    pipelineId: "pipe-1",
    ownerId: "u1",
    name: "Revenue",
    kind: "metric",
    config,
    schema: [],
    createdAt: "",
    updatedAt: "",
  };
}

// First-200-rows sum is 900; the server's all-rows value is 1204.
const ROWS = { rawRows: [["400"], ["500"]], headers: ["amount"] };

const PANEL = makeOutputPanel();

function renderMetric(props: Partial<PanelContentProps> = {}) {
  return renderWithStore(
    <PanelContent crossFilterMode="none" panel={PANEL} {...ROWS} {...props} />,
  );
}

beforeEach(() => {
  resetHistoryCache();
  resetComparisonStore();
  getOutputById.mockReset().mockResolvedValue(makeOutput());
  fetchHistory.mockReset().mockResolvedValue(makeHistory());
  fetchPublicHistory.mockReset().mockResolvedValue(makeHistory());
});

describe("PanelContent — metric history (HEL-1275)", () => {
  it("shows the server all-rows headline, the 7d delta and a sparkline", async () => {
    renderMetric();
    expect(await screen.findByText("1,204")).toBeInTheDocument();
    expect(screen.queryByText("900")).toBeNull();
    expect(screen.getByRole("img", { name: /^up 12%/ })).toHaveTextContent("▲ 12% vs 7d");
    expect(screen.getByRole("img", { name: /Trend over 3 data points/ })).toBeInTheDocument();
  });

  it("falls back to the loaded-rows value when there is no history yet", async () => {
    fetchHistory.mockResolvedValue(makeHistory({ current: null, baseline: null, points: [] }));
    renderMetric();
    expect(await screen.findByText("900")).toBeInTheDocument();
    await waitFor(() => expect(fetchHistory).toHaveBeenCalled());
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("falls back and renders no comparison when the config changed since the last run", async () => {
    getOutputById.mockResolvedValue(
      makeOutput({ ...METRIC_CONFIG, aggregation: { value: "amount", agg: "avg" } }),
    );
    renderMetric();
    await waitFor(() => expect(fetchHistory).toHaveBeenCalled());
    expect(await screen.findByText("450")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("an applied viewer filter computes the headline from the filtered rows and shows the marker", async () => {
    // One row survives the filter: the editor-shaped aggregate (sum over `aggregation.value`)
    // must give 600, not "--".
    const control = { id: "c1", kind: "dropdown" as const, column: "region", label: "Region" };
    const ops = buildViewerControlFilterOps([control], { c1: "west" });
    renderMetric({
      viewerFilterActive: ops.length > 0,
      rawRows: [["600"]],
      headers: ["amount"],
    });
    expect(await screen.findByText("600")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTitle("comparison reflects unfiltered data")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText(/vs 7d/)).toBeNull();
  });

  it("a server cross-filter narrowing this panel hides the delta the same way", async () => {
    renderMetric({ crossFilterMode: "server" });
    await waitFor(() =>
      expect(screen.getByTitle("comparison reflects unfiltered data")).toBeInTheDocument(),
    );
    expect(screen.queryByText(/vs 7d/)).toBeNull();
  });

  it("GUARD (D5 existing-disclosure): a client-side cross-filter over truncated rows keeps the loaded-rows value and shows the HEL-588 disclosure, ignoring a filtered server metric", async () => {
    const config = { ...METRIC_CONFIG, fieldMapping: { value: "amount", label: "region" } };
    getOutputById.mockResolvedValue(makeOutput(config));
    renderWithStore(
      <PanelContent
        crossFilterMode="client-fallback"
        panel={PANEL}
        rawRows={[
          ["400", "east"],
          ["500", "west"],
        ]}
        headers={["amount", "region"]}
        rowsTruncated
        totalRowCount={500}
        filteredMetric={{ field: "amount", agg: "sum", value: 9999 }}
      />,
      {
        panels: {
          items: [],
          crossFilter: { panelId: "other-panel", dimension: "region", value: "east", series: "x" },
        },
      },
    );
    expect(await screen.findByText("400")).toBeInTheDocument();
    expect(screen.queryByText("9,999")).toBeNull();
    expect(screen.getByText(/1 of 2 loaded rows match\./)).toBeInTheDocument();
  });

  it("an empty dropdown control value builds no filter ops, so the delta still renders", async () => {
    const control = { id: "c1", kind: "dropdown" as const, column: "region", label: "Region" };
    // The SAME builder the call sites use to derive `viewerFilterActive`.
    const empty = buildViewerControlFilterOps([control], { c1: "" });
    expect(empty).toEqual([]);
    renderMetric({ viewerFilterActive: empty.length > 0 });
    expect(await screen.findByText(/vs 7d/)).toBeInTheDocument();
    expect(screen.queryByTitle("comparison reflects unfiltered data")).toBeNull();
  });

  it("a selected dropdown control value builds an op and hides the delta", async () => {
    const control = { id: "c1", kind: "dropdown" as const, column: "region", label: "Region" };
    const ops = buildViewerControlFilterOps([control], { c1: "west" });
    expect(ops).toHaveLength(1);
    renderMetric({ viewerFilterActive: ops.length > 0 });
    await waitFor(() =>
      expect(screen.getByTitle("comparison reflects unfiltered data")).toBeInTheDocument(),
    );
  });

  it("publishes the comparison for provenance only while the delta shows (publisher side)", async () => {
    const panel = makeOutputPanel();
    const key = `authenticated:${panel.id}`;
    const control = { id: "c1", kind: "dropdown" as const, column: "region", label: "Region" };
    const none = buildViewerControlFilterOps([control], { c1: "" });
    const west = buildViewerControlFilterOps([control], { c1: "west" });

    const { unmount } = renderWithStore(
      <PanelContent
        crossFilterMode="none"
        panel={panel}
        {...ROWS}
        viewerFilterActive={none.length > 0}
      />,
    );
    await waitFor(() => expect(getPublishedComparison(key)).not.toBeNull());
    expect(getPublishedComparison(key)?.baselineText).toBe("1,075");
    unmount();
    expect(getPublishedComparison(key)).toBeNull();

    renderWithStore(
      <PanelContent
        crossFilterMode="none"
        panel={panel}
        {...ROWS}
        viewerFilterActive={west.length > 0}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTitle("comparison reflects unfiltered data")).toBeInTheDocument(),
    );
    expect(getPublishedComparison(key)).toBeNull();
  });

  it("a compare saved after the history was cached hides the stale delta and refetches once", async () => {
    // Cached history resolved for "7d"; the Output config now says "30d".
    getOutputById.mockResolvedValue(makeOutput({ ...METRIC_CONFIG, compare: "30d" }));
    // A FRESH object per call (a shared object would never re-render, hiding a refetch loop), for
    // a finite budget of 5 calls; a loop would reach it, the bound stops at 2.
    let calls = 0;
    fetchHistory.mockImplementation(() =>
      ++calls <= 5 ? Promise.resolve(makeHistory({ compare: "7d" })) : new Promise(() => {}),
    );
    renderMetric();
    expect(await screen.findByText("1,204")).toBeInTheDocument();
    await waitFor(() => expect(fetchHistory).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/vs 7d/)).toBeNull();
    expect(screen.queryByRole("img", { name: /^up/ })).toBeNull();
    expect(getPublishedComparison(`authenticated:${PANEL.id}`)).toBeNull();
    // The refetch is bounded: a server still answering "7d" does not loop.
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchHistory).toHaveBeenCalledTimes(2);
  });

  it("the refetched history for the new compare renders its delta", async () => {
    getOutputById.mockResolvedValue(makeOutput({ ...METRIC_CONFIG, compare: "30d" }));
    fetchHistory
      .mockResolvedValueOnce(makeHistory({ compare: "7d" }))
      .mockResolvedValue(makeHistory({ compare: "30d" }));
    renderMetric();
    expect(await screen.findByText(/vs 30d/)).toBeInTheDocument();
    expect(screen.queryByText(/vs 7d/)).toBeNull();
  });

  it("compare None (null) against a cached 7d history shows no delta", async () => {
    getOutputById.mockResolvedValue(makeOutput({ ...METRIC_CONFIG, compare: null }));
    renderMetric();
    expect(await screen.findByText("1,204")).toBeInTheDocument();
    await waitFor(() => expect(fetchHistory).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/vs 7d/)).toBeNull();
  });

  it("shows the available-from note when the baseline is missing", async () => {
    fetchHistory.mockResolvedValue(
      makeHistory({
        baseline: null,
        delta: null,
        pct: null,
        availableFrom: "2026-10-12T09:00:00Z",
      }),
    );
    renderMetric();
    expect(await screen.findByText(/7d comparison available from/)).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /^up/ })).toBeNull();
  });

  it("hides a delta whose baseline was computed under another aggregation", async () => {
    fetchHistory.mockResolvedValue(
      makeHistory({
        points: [
          metricPoint(HEAD_AT, 1204),
          metricPoint("2026-09-28T09:00:00Z", 1075, { agg: "avg" }),
        ],
      }),
    );
    renderMetric();
    expect(await screen.findByText("1,204")).toBeInTheDocument();
    expect(screen.queryByText(/vs 7d/)).toBeNull();
  });

  it("reads the public history route when given a historySource", async () => {
    renderMetric({ historySource: { variant: "public", dashboardId: "d1", token: "tok" } });
    expect(await screen.findByText("1,204")).toBeInTheDocument();
    expect(fetchPublicHistory).toHaveBeenCalledWith("d1", expect.any(String), "tok");
    expect(fetchHistory).not.toHaveBeenCalled();
  });
});
