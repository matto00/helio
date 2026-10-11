// HEL-1305 -- the editor preview types its x field from the node's capability columns, so it
// renders a timestamp x like the saved dashboard does.
import { configureStore } from "@reduxjs/toolkit";
import { render, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { httpClient } from "../../../../services/httpClient";
import { outputsReducer } from "../../state/outputsSlice";
import { OutputEditorSheet } from "./OutputEditorSheet";
import type { Output } from "../../types/output";

jest.mock("../../../../services/httpClient", () => ({
  httpClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
const http = jest.mocked(httpClient);

const captured: Array<{
  fieldTypes?: Record<string, string> | null;
  chartAggregate?: { groupBy?: string } | null;
}> = [];
jest.mock("../../../panels/ui/renderers/ChartRenderer", () => ({
  ChartRenderer: (props: { fieldTypes?: Record<string, string> | null }) => {
    captured.push(props);
    return <div data-testid="chart" />;
  },
}));

beforeEach(() => {
  captured.length = 0;
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
  jest.clearAllMocks();
  http.post.mockResolvedValue({ data: { outputs: [{ outputId: "o-1", preview: PREVIEW }] } });
  http.get.mockImplementation((url: string) =>
    Promise.resolve(
      url.endsWith("/panels")
        ? { data: [] }
        : {
            data: {
              columns: [
                { name: "day", dataType: "timestamp", nullable: false },
                { name: "n", dataType: "integer", nullable: false },
              ],
              capabilities: {},
              rows: [{ day: "2026-10-01", n: 1 }],
              rowCount: 1,
              stepRowCounts: {},
              sourceRowCount: 1,
              blocked: false,
              sourceTruncated: false,
              truncatedReads: [],
            },
          },
    ),
  );
});

const PREVIEW = {
  columns: [
    { name: "day", dataType: "timestamp", nullable: false },
    { name: "n", dataType: "integer", nullable: false },
  ],
  rows: [{ day: "2026-10-01", n: 1 }],
  rowCount: 1,
  stepRowCounts: {},
  sourceRowCount: 1,
  blocked: false,
  sourceTruncated: false,
  truncatedReads: [],
};

const output: Output = {
  id: "o-1",
  pipelineId: "p-1",
  nodeStepId: "step-1",
  ownerId: "u-1",
  name: "CI",
  kind: "chart",
  config: { chartType: "line", fieldMapping: { xAxis: "day", yAxis: "n" } },
  schema: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("OutputEditorSheet preview field types (HEL-1305)", () => {
  it("types the preview's x field from the node's capability columns", async () => {
    render(
      <MemoryRouter>
        <Provider store={configureStore({ reducer: { outputs: outputsReducer } })}>
          <OutputEditorSheet open onClose={jest.fn()} pipelineId="p-1" output={output} steps={[]} />
        </Provider>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(captured.at(-1)?.fieldTypes).toEqual({ day: "timestamp", n: "integer" }),
    );
  });
});
