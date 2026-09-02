import { configureStore } from "@reduxjs/toolkit";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { createElement } from "react";
import { Provider } from "react-redux";

import { panelsReducer } from "../state/panelsSlice";
import * as outputService from "../../pipelines/services/outputService";
import { makeOutputPanel, makeTextPanel } from "../../../test/panelFixtures";
import type { Panel } from "../types/panel";
import { usePanelData } from "./usePanelData";

jest.mock("../../pipelines/services/outputService");

const mockGetOutputRows = outputService.getOutputRows as jest.MockedFunction<
  typeof outputService.getOutputRows
>;

function makeStore(panel?: Panel) {
  return configureStore({
    reducer: {
      panels: panelsReducer,
    } as never,
    preloadedState: panel
      ? ({
          panels: {
            items: [panel],
            loadedDashboardId: "d1",
            status: "succeeded",
            error: null,
            pendingPanelUpdates: {},
            lastSavedAt: null,
            paginationState: {},
          },
        } as never)
      : undefined,
  });
}

function wrapper(store: ReturnType<typeof makeStore>) {
  return function Wrapper({ children }: PropsWithChildren) {
    return createElement(Provider, { store } as never, children);
  };
}

describe("usePanelData", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns empty result for a non-output panel (no outputId)", () => {
    const store = makeStore();
    const panel = makeTextPanel({ id: "p1" });

    const { result } = renderHook(() => usePanelData(panel), { wrapper: wrapper(store) });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.rawRows).toBeNull();
    expect(result.current.headers).toBeNull();
    expect(mockGetOutputRows).not.toHaveBeenCalled();
  });

  it("fetches rows for an output-kind panel's bound Output", async () => {
    mockGetOutputRows.mockResolvedValue({
      items: [{ region: "west", amount: 10 }],
      total: 1,
      offset: 0,
      limit: 200,
    });
    const panel = makeOutputPanel({ id: "p1", config: { outputId: "out-1" } });
    const store = makeStore(panel);

    const { result } = renderHook(() => usePanelData(panel), { wrapper: wrapper(store) });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockGetOutputRows).toHaveBeenCalledWith("out-1", 0, 200);
    expect(result.current.rawRows).toEqual([["west", "10"]]);
    expect(result.current.headers).toEqual(["region", "amount"]);
    expect(result.current.noData).toBe(false);
    expect(result.current.chartAggregate).toBeNull();
  });

  it("reports noData when the Output has no rows", async () => {
    mockGetOutputRows.mockResolvedValue({ items: [], total: 0, offset: 0, limit: 200 });
    const panel = makeOutputPanel({ id: "p1", config: { outputId: "out-1" } });
    const store = makeStore(panel);

    const { result } = renderHook(() => usePanelData(panel), { wrapper: wrapper(store) });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.noData).toBe(true);
  });

  it("surfaces a fetch error", async () => {
    mockGetOutputRows.mockRejectedValue(new Error("boom"));
    const panel = makeOutputPanel({ id: "p1", config: { outputId: "out-1" } });
    const store = makeStore(panel);

    const { result } = renderHook(() => usePanelData(panel), { wrapper: wrapper(store) });

    await waitFor(() => expect(result.current.error).not.toBeNull());
  });

  it("refresh() triggers a re-fetch", async () => {
    mockGetOutputRows.mockResolvedValue({
      items: [{ n: 1 }],
      total: 1,
      offset: 0,
      limit: 200,
    });
    const panel = makeOutputPanel({ id: "p1", config: { outputId: "out-1" } });
    const store = makeStore(panel);

    const { result } = renderHook(() => usePanelData(panel), { wrapper: wrapper(store) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockGetOutputRows).toHaveBeenCalledTimes(1);

    act(() => result.current.refresh());
    await waitFor(() => expect(mockGetOutputRows).toHaveBeenCalledTimes(2));
  });
});
