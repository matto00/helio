// HEL-1358 design D5 — the fullscreen overlay reads the panel's pagination `total` for the chart note.

import { screen } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import { makeOutputPanel } from "../../../test/panelFixtures";
import { getOutputById as getOutputByIdRequest } from "../../pipelines/services/outputService";
import type { Output } from "../../pipelines/types/output";
import { PanelFullscreenOverlay } from "./PanelFullscreenOverlay";

jest.mock("echarts-for-react/esm/core", () => ({
  __esModule: true,
  default: () => <div data-testid="echarts" />,
}));
jest.mock("./echartsCore", () => ({ __esModule: true, default: {} }));
jest.mock("../../pipelines/services/outputService", () => ({ getOutputById: jest.fn() }));

const output: Output = {
  id: "output-1",
  pipelineId: "pipe-1",
  ownerId: "u1",
  name: "Revenue",
  kind: "chart",
  config: { chartType: "line", fieldMapping: { xAxis: "day", yAxis: "amount" } },
  schema: [],
  createdAt: "",
  updatedAt: "",
};

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
  jest.mocked(getOutputByIdRequest).mockResolvedValue(output);
});

it("shows the truncation note from the panel's pagination total", async () => {
  const panel = makeOutputPanel({ id: "p1", title: "Revenue" });
  renderWithStore(
    <PanelFullscreenOverlay
      crossFilterMode="none"
      panel={panel}
      open
      onClose={jest.fn()}
      data={null}
      rawRows={[["Mon", "5"]]}
      headers={["day", "amount"]}
      paginationRows={[{ day: "Mon", amount: 5 }]}
      isLoading={false}
      error={null}
      errorKind={null}
      noData={false}
      neverMaterialized={false}
      rowsTruncated
      refresh={jest.fn()}
      chartInspectConfig={null}
    />,
    {
      panels: {
        items: [panel],
        paginationState: {
          p1: {
            currentPage: 0,
            hasMore: true,
            isLoadingMore: false,
            rows: [],
            materialized: true,
            total: 5000,
          },
        },
      },
    },
  );
  expect(await screen.findByText(/Based on the first 1 of 5,000 rows\./)).toBeInTheDocument();
});
