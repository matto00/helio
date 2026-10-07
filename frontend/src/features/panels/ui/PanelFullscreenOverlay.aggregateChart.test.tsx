import { screen } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import { makeOutputPanel } from "../../../test/panelFixtures";
import { getOutputById as getOutputByIdRequest } from "../../pipelines/services/outputService";
import type { Output } from "../../pipelines/types/output";
import { PanelFullscreenOverlay } from "./PanelFullscreenOverlay";

// HEL-1351 design D2 — the fullscreen overlay receives the loaded record rows (`paginationRows`)
// and renders an aggregated chart Output grouped, exactly as the dashboard card does.

jest.mock("echarts-for-react/esm/core", () => ({
  __esModule: true,
  default: ({ option }: { option: unknown }) => (
    <div data-testid="echarts" data-option={JSON.stringify(option)} />
  ),
}));
jest.mock("./echartsCore", () => ({ __esModule: true, default: {} }));
jest.mock("../../pipelines/services/outputService", () => ({ getOutputById: jest.fn() }));

const output: Output = {
  id: "output-1",
  pipelineId: "pipe-1",
  ownerId: "u1",
  name: "Revenue",
  kind: "chart",
  config: {
    chartType: "bar",
    fieldMapping: { xAxis: "region", yAxis: "amount" },
    aggregation: { groupBy: "region", agg: "sum", yField: "amount" },
  },
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

it("renders the grouped aggregate from the supplied record rows", async () => {
  const panel = makeOutputPanel({ title: "Revenue" });
  renderWithStore(
    <PanelFullscreenOverlay
      crossFilterMode="none"
      panel={panel}
      open
      onClose={jest.fn()}
      data={null}
      rawRows={[
        ["east", "10"],
        ["east", "5"],
        ["west", "7"],
      ]}
      headers={["region", "amount"]}
      paginationRows={[
        { region: "east", amount: 10 },
        { region: "east", amount: 5 },
        { region: "west", amount: 7 },
      ]}
      isLoading={false}
      error={null}
      errorKind={null}
      noData={false}
      neverMaterialized={false}
      rowsTruncated={false}
      refresh={jest.fn()}
      chartInspectConfig={null}
    />,
  );
  const chart = await screen.findByTestId("echarts");
  const opt = JSON.parse(chart.getAttribute("data-option") ?? "{}") as {
    xAxis?: { data?: unknown[] };
    series?: { type?: string; name?: string; data?: unknown[] }[];
  };
  expect(opt.xAxis?.data).toEqual(["east", "west"]);
  expect(opt.series?.[0]).toMatchObject({ type: "bar", name: "sum(amount)", data: [15, 7] });
});
