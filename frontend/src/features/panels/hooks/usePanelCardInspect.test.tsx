import { renderHook } from "@testing-library/react";

import { makeOutputPanel } from "../../../test/panelFixtures";
import type { Output } from "../../pipelines/types/output";
import { usePanelCardInspect } from "./usePanelCardInspect";
import { useOutputMeta } from "./useOutputMeta";
import type { PanelDataResult } from "./usePanelData";

jest.mock("../../../hooks/reduxHooks", () => ({ useAppDispatch: () => jest.fn() }));
jest.mock("./useOutputMeta", () => ({ useOutputMeta: jest.fn() }));
jest.mock("./useCrossFilterServerOps", () => ({
  useCrossFilterServerOps: () => ({ mode: "client" }),
}));
jest.mock("./useCrossFilteredPanelData", () => ({
  useCrossFilteredPanelData: () => ({ rawRows: null, headers: null, records: null }),
}));

const mockUseOutputMeta = jest.mocked(useOutputMeta);

function makeOutput(overrides: Partial<Output>): Output {
  return {
    id: "o1",
    pipelineId: "p1",
    ownerId: "u1",
    name: "Spend",
    kind: "chart",
    config: { fieldMapping: { xAxis: "category", yAxis: "amount_usd" } },
    schema: [
      { name: "date", type: "string" },
      { name: "category", type: "string" },
      { name: "merchant", type: "string" },
      { name: "amount_usd", type: "number" },
    ],
    createdAt: "",
    updatedAt: "",
    ...overrides,
  } as Output;
}

function run(output: Output) {
  mockUseOutputMeta.mockReturnValue({ output, isLoading: false });
  return renderHook(() =>
    usePanelCardInspect(makeOutputPanel({ title: "Spend" }), "o1", {} as PanelDataResult),
  ).result.current.chartInspectConfig;
}

describe("usePanelCardInspect -- HEL-1394 column order hint", () => {
  it("derives the hint from the Output's schema names", () => {
    expect(run(makeOutput({}))?.columnOrderHint).toEqual({
      schema: ["date", "category", "merchant", "amount_usd"],
      columnOrder: undefined,
    });
  });

  it("carries the config's columnOrder when present", () => {
    const cfg = run(
      makeOutput({ config: { fieldMapping: { xAxis: "category" }, columnOrder: ["merchant"] } }),
    );
    expect(cfg?.columnOrderHint?.columnOrder).toEqual(["merchant"]);
  });
});
