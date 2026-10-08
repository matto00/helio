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

// HEL-1182: the metric value must be resolved by `fieldMapping` KEY, never by key position. The
// backend's jsonb round-trip returns `{value, label}` as `{label, value}`; these tests hand the
// panel that order directly (plain-object string keys iterate in insertion order).

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

// D1: `rank` is numeric and differs from `amount`, so a wrong pick shows a plausible wrong number.
// amount: 42 (first row), sum 52.  rank: 7 (first row), sum 15.
const ROWS = {
  rawRows: [
    ["42", "7"],
    ["10", "8"],
  ],
  headers: ["amount", "rank"],
};

const MAPPINGS: Array<[string, Record<string, string>]> = [
  ["value-first (baseline control)", { value: "amount", label: "rank" }],
  ["label-first", { label: "rank", value: "amount" }],
  ["unit-first", { unit: "rank", value: "amount" }],
  ["unit+label-first", { unit: "rank", label: "rank", value: "amount" }],
];

const EMPTY_HISTORY = () => makeHistory({ current: null, baseline: null, points: [] });

function makeOutput(config: Record<string, unknown>): Output {
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

function renderMetric(config: Record<string, unknown>, props: Partial<PanelContentProps> = {}) {
  getOutputById.mockResolvedValue(makeOutput(config));
  return renderWithStore(
    <PanelContent crossFilterMode="none" panel={makeOutputPanel()} {...ROWS} {...props} />,
  );
}

beforeEach(() => {
  resetHistoryCache();
  resetComparisonStore();
  getOutputById.mockReset();
  fetchHistory.mockReset().mockResolvedValue(EMPTY_HISTORY());
});

describe.each(MAPPINGS)("MetricOutputPanel with a %s fieldMapping (HEL-1182)", (name, mapping) => {
  it("precondition: the mapping really is in the order the case names", () => {
    const keys = Object.keys(mapping);
    if (name.startsWith("value-first")) expect(keys[0]).toBe("value");
    else expect(keys[0]).not.toBe("value");
  });

  it("(a) loaded first-row value comes from the value column", async () => {
    renderMetric({ fieldMapping: mapping });
    expect(await screen.findByText("42")).toBeInTheDocument();
    expect(screen.queryByText("7")).toBeNull();
    await waitFor(() => expect(fetchHistory).toHaveBeenCalled());
  });

  it("(b) loaded aggregate value comes from the value column", async () => {
    renderMetric({ fieldMapping: mapping, aggregation: { agg: "sum" } });
    expect(await screen.findByText("52")).toBeInTheDocument();
    expect(screen.queryByText("15")).toBeNull();
    await waitFor(() => expect(fetchHistory).toHaveBeenCalled());
  });

  it("(c) a server filteredMetric on the value column is accepted, not discarded as an identity mismatch", async () => {
    // 999 differs from the loaded sum (52) and the rank sum (15): seeing 999 proves acceptance.
    renderMetric(
      { fieldMapping: mapping, aggregation: { agg: "sum" } },
      { viewerFilterActive: true, filteredMetric: { field: "amount", agg: "sum", value: 999 } },
    );
    expect(await screen.findByText("999")).toBeInTheDocument();
    expect(screen.queryByText("15")).toBeNull();
    expect(screen.queryByText("52")).toBeNull();
  });

  it("(d) the server history headline is used because its identity matches the value column", async () => {
    // 1204 differs from the loaded sum (52): seeing it proves the headline identity matched.
    fetchHistory.mockResolvedValue(makeHistory());
    renderMetric({ fieldMapping: mapping, aggregation: { agg: "sum" }, format: "integer" });
    expect(await screen.findByText("1,204")).toBeInTheDocument();
    expect(screen.queryByText("52")).toBeNull();
    expect(screen.queryByText("15")).toBeNull();
  });
});
