// HEL-1744 D7 -- a panel bound to an `insight` Output never requests the Output's rows once its kind is known.
import { configureStore } from "@reduxjs/toolkit";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { Provider } from "react-redux";

import { panelsReducer } from "../state/panelsSlice";
import { invalidatePipeline, resetOutputFreshness, retain } from "../state/outputFreshness";
import { fetchOutputMeta } from "../state/outputMetaCache";
import * as outputService from "../../pipelines/services/outputService";
import { hasRunBaseline } from "../services/pipelineRunFanout";
import { makeOutputPanel } from "../../../test/panelFixtures";
import { makeOutput } from "../../../test/remountFixtures";
import { usePanelData } from "./usePanelData";

jest.mock("../../pipelines/services/outputService", () => ({
  ...jest.requireActual("../../pipelines/services/outputService"),
  getOutputRows: jest.fn(),
  getOutputById: jest.fn(),
}));
jest.mock("../services/pipelineRunFanout", () => ({ hasRunBaseline: jest.fn() }));

const rows = outputService.getOutputRows as jest.MockedFunction<typeof outputService.getOutputRows>;
const byId = outputService.getOutputById as jest.MockedFunction<typeof outputService.getOutputById>;
const baseline = hasRunBaseline as jest.MockedFunction<typeof hasRunBaseline>;

const panel = makeOutputPanel({ id: "p1", config: { outputId: "o1" } });

function wrapper() {
  const store = configureStore({
    reducer: { panels: panelsReducer } as never,
    preloadedState: {
      panels: { ...panelsReducer(undefined, { type: "@@INIT" }), items: [panel] },
    } as never,
  });
  return function Wrapper({ children }: PropsWithChildren) {
    return createElement(Provider, { store } as never, children);
  };
}

describe("usePanelData for an insight Output", () => {
  beforeEach(() => {
    resetOutputFreshness();
    jest.clearAllMocks();
    baseline.mockReturnValue(true);
    rows.mockResolvedValue({
      items: [{ a: 1 }],
      total: 1,
      offset: 0,
      limit: 200,
      materialized: true,
    });
  });

  it("makes no rows request when the held metadata says the Output is an insight", async () => {
    byId.mockResolvedValue(makeOutput("o1", "insight", {}));
    await fetchOutputMeta("o1");
    retain("o1");
    const { result } = renderHook(() => usePanelData(panel), { wrapper: wrapper() });
    await waitFor(() => expect(result.current).toBeDefined());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(rows).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("still fetches rows for a table Output", async () => {
    byId.mockResolvedValue(makeOutput("o2", "table", {}));
    await fetchOutputMeta("o2");
    retain("o2");
    const other = makeOutputPanel({ id: "p2", config: { outputId: "o2" } });
    const { result } = renderHook(() => usePanelData(other), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.rawRows).not.toBeNull());
    expect(rows).toHaveBeenCalledTimes(1);
  });

  it("makes no rows request after a run invalidates the held metadata (refresh included)", async () => {
    byId.mockResolvedValue({ ...makeOutput("o1", "insight", {}), pipelineId: "pipe-1" });
    await fetchOutputMeta("o1");
    retain("o1");
    const { result } = renderHook(() => usePanelData(panel), { wrapper: wrapper() });
    await new Promise((resolve) => setTimeout(resolve, 20));
    // A pipeline run completes: the held metadata is dropped, the Output's kind is not.
    invalidatePipeline("pipe-1");
    await act(async () => {
      result.current.refresh();
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(rows).not.toHaveBeenCalled();
  });

  it("cold first load makes exactly one (ignored) rows request, then none once the kind is known", async () => {
    byId.mockResolvedValue({ ...makeOutput("o1", "insight", {}), pipelineId: "pipe-1" });
    const { result } = renderHook(() => usePanelData(panel), { wrapper: wrapper() });
    await waitFor(() => expect(rows).toHaveBeenCalledTimes(1));
    await fetchOutputMeta("o1"); // the panel body resolves the metadata
    await act(async () => {
      result.current.refresh();
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(rows).toHaveBeenCalledTimes(1);
  });
});
