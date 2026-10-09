import { screen, waitFor } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import { PanelContent, type PanelContentProps } from "./PanelContent";
import { makeOutputPanel } from "../../../test/panelFixtures";
import { getOutputById as getOutputByIdRequest } from "../../pipelines/services/outputService";
import * as service from "../history/outputHistoryService";
import { resetHistoryCache } from "../history/outputHistoryCache";
import { resetComparisonStore } from "../history/metricComparisonStore";
import { makeHistory } from "../history/historyFixtures";
import type { Output } from "../../pipelines/types/output";

// HEL-1408 design D6: a metric `count` over the loaded rows excludes null cells (as the server
// headline does). `rawRows` stringify a null as "" -- which `count` would count -- so the panel
// aggregates the typed `paginationRows` records instead.

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

const HEADERS = ["team"];
const RAW_ROWS = [["a"], [""], ["b"]];
const RECORDS: Record<string, unknown>[] = [{ team: "a" }, { team: null }, { team: "b" }];

const CONFIG = { fieldMapping: { value: "team" }, aggregation: { agg: "count" } };

function makeOutput(): Output {
  return {
    id: "output-1",
    pipelineId: "pipe-1",
    ownerId: "u1",
    name: "Teams",
    kind: "metric",
    config: CONFIG,
    schema: [],
    createdAt: "",
    updatedAt: "",
  };
}

function renderMetric(props: Partial<PanelContentProps>) {
  getOutputById.mockResolvedValue(makeOutput());
  return renderWithStore(
    <PanelContent
      crossFilterMode="none"
      panel={makeOutputPanel()}
      rawRows={RAW_ROWS}
      headers={HEADERS}
      {...props}
    />,
  );
}

beforeEach(() => {
  resetHistoryCache();
  resetComparisonStore();
  getOutputById.mockReset();
  fetchHistory
    .mockReset()
    .mockResolvedValue(makeHistory({ current: null, baseline: null, points: [] }));
});

describe("MetricOutputPanel count with a null cell (HEL-1408)", () => {
  it("counts 2, not 3, when the typed records hold a null", async () => {
    renderMetric({ paginationRows: RECORDS });
    expect(await screen.findByText("2")).toBeInTheDocument();
    expect(screen.queryByText("3")).toBeNull();
    await waitFor(() => expect(fetchHistory).toHaveBeenCalled());
  });

  it("falls back to the stringified rawRows when no records are loaded (unchanged)", async () => {
    renderMetric({});
    expect(await screen.findByText("3")).toBeInTheDocument();
    await waitFor(() => expect(fetchHistory).toHaveBeenCalled());
  });
});
