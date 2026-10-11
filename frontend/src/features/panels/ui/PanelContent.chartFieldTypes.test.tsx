// HEL-1305 -- the bound Output's schema reaches the chart through the real PanelContent path.
import { screen, waitFor } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import { PanelContent } from "./PanelContent";
import { makeOutputPanel } from "../../../test/panelFixtures";
import { getOutputById as getOutputByIdRequest } from "../../pipelines/services/outputService";
import { resetHistoryCache } from "../history/outputHistoryCache";
import type { Output } from "../../pipelines/types/output";

jest.mock("../../pipelines/services/outputService", () => ({ getOutputById: jest.fn() }));
jest.mock("../history/outputHistoryService", () => ({
  fetchOutputHistory: jest.fn(),
  fetchPublicOutputHistory: jest.fn(),
}));
jest.mock("../services/pipelineRunFanout", () => ({
  subscribeToPipelineTerminal: jest.fn(() => jest.fn()),
}));

const types: Array<Record<string, string> | null | undefined> = [];
jest.mock("./renderers/ChartRenderer", () => ({
  ChartRenderer: ({ fieldTypes }: { fieldTypes?: Record<string, string> | null }) => {
    types.push(fieldTypes);
    return <div data-testid="chart" />;
  },
}));

const getOutputById = jest.mocked(getOutputByIdRequest);

const output: Output = {
  id: "output-1",
  pipelineId: "pipe-1",
  ownerId: "u1",
  name: "CI health",
  kind: "chart",
  config: { chartType: "line", fieldMapping: { xAxis: "day", yAxis: "amount" } },
  schema: [
    { name: "day", type: "timestamp" },
    { name: "amount", type: "float" },
  ],
  createdAt: "",
  updatedAt: "",
};

beforeEach(() => {
  types.length = 0;
  resetHistoryCache();
  getOutputById.mockReset().mockResolvedValue(output);
});

describe("PanelContent chart field types (HEL-1305)", () => {
  it("hands the chart the bound Output's declared schema types", async () => {
    renderWithStore(
      <PanelContent
        crossFilterMode="none"
        panel={makeOutputPanel()}
        rowsTruncated={false}
        rawRows={[["2026-10-01", "5"]]}
        headers={["day", "amount"]}
      />,
    );
    await screen.findByTestId("chart");
    await waitFor(() => expect(types.at(-1)).toEqual({ day: "timestamp", amount: "float" }));
  });
});
