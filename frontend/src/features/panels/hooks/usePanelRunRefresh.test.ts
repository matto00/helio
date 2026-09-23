import { renderHook } from "@testing-library/react";

import { subscribeToPipelineSucceeded } from "../services/pipelineRunFanout";
import { useOutputMeta } from "./useOutputMeta";
import { usePanelRunRefresh } from "./usePanelRunRefresh";
import type { Output } from "../../pipelines/types/output";

jest.mock("../services/pipelineRunFanout", () => ({
  subscribeToPipelineSucceeded: jest.fn(),
}));

jest.mock("./useOutputMeta", () => ({
  useOutputMeta: jest.fn(),
}));

const mockSubscribe = jest.mocked(subscribeToPipelineSucceeded);
const mockUseOutputMeta = jest.mocked(useOutputMeta);

function makeOutput(overrides: Partial<Output> = {}): Output {
  return {
    id: "out-1",
    pipelineId: "pipe-1",
    ownerId: "u1",
    name: "Output",
    kind: "chart",
    config: {},
    schema: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("usePanelRunRefresh", () => {
  beforeEach(() => {
    mockSubscribe.mockReset();
    mockUseOutputMeta.mockReset();
  });

  it("does not subscribe when outputId is null", () => {
    mockUseOutputMeta.mockReturnValue({ output: null, isLoading: false });
    const refresh = jest.fn();

    renderHook(() => usePanelRunRefresh(null, refresh));

    expect(mockUseOutputMeta).toHaveBeenCalledWith(null);
    expect(mockSubscribe).not.toHaveBeenCalled();
  });

  it("does not subscribe while the Output's pipelineId hasn't resolved yet", () => {
    mockUseOutputMeta.mockReturnValue({ output: null, isLoading: true });
    const refresh = jest.fn();

    renderHook(() => usePanelRunRefresh("out-1", refresh));

    expect(mockSubscribe).not.toHaveBeenCalled();
  });

  it("subscribes to the resolved pipelineId once the Output loads", () => {
    mockUseOutputMeta.mockReturnValue({
      output: makeOutput({ pipelineId: "pipe-42" }),
      isLoading: false,
    });
    const unsubscribe = jest.fn();
    mockSubscribe.mockReturnValue(unsubscribe);
    const refresh = jest.fn();

    renderHook(() => usePanelRunRefresh("out-1", refresh));

    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    expect(mockSubscribe).toHaveBeenCalledWith("pipe-42", expect.any(Function));
  });

  it("calls refresh when the manager delivers a succeeded event", () => {
    mockUseOutputMeta.mockReturnValue({ output: makeOutput(), isLoading: false });
    let deliveredCallback: (() => void) | undefined;
    mockSubscribe.mockImplementation((_pipelineId, onSucceeded) => {
      deliveredCallback = onSucceeded;
      return jest.fn();
    });
    const refresh = jest.fn();

    renderHook(() => usePanelRunRefresh("out-1", refresh));

    expect(deliveredCallback).toBeDefined();
    deliveredCallback?.();

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does NOT call refresh after unmount", () => {
    mockUseOutputMeta.mockReturnValue({ output: makeOutput(), isLoading: false });
    let deliveredCallback: (() => void) | undefined;
    const unsubscribe = jest.fn(() => {
      deliveredCallback = undefined;
    });
    mockSubscribe.mockImplementation((_pipelineId, onSucceeded) => {
      deliveredCallback = onSucceeded;
      return unsubscribe;
    });
    const refresh = jest.fn();

    const { unmount } = renderHook(() => usePanelRunRefresh("out-1", refresh));

    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    // The manager itself would not call a callback after the consumer's own
    // unsubscribe ran; simulate that contract directly since the manager is mocked here.
    expect(deliveredCallback).toBeUndefined();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("unsubscribes from the old pipelineId and subscribes to the new one when outputId changes", () => {
    const unsubscribeA = jest.fn();
    const unsubscribeB = jest.fn();
    mockSubscribe.mockReturnValueOnce(unsubscribeA).mockReturnValueOnce(unsubscribeB);
    mockUseOutputMeta.mockReturnValue({
      output: makeOutput({ pipelineId: "pipe-a" }),
      isLoading: false,
    });
    const refresh = jest.fn();

    const { rerender } = renderHook(({ outputId }) => usePanelRunRefresh(outputId, refresh), {
      initialProps: { outputId: "out-a" as string | null },
    });

    expect(mockSubscribe).toHaveBeenCalledWith("pipe-a", expect.any(Function));

    mockUseOutputMeta.mockReturnValue({
      output: makeOutput({ pipelineId: "pipe-b" }),
      isLoading: false,
    });
    rerender({ outputId: "out-b" });

    expect(unsubscribeA).toHaveBeenCalledTimes(1);
    expect(mockSubscribe).toHaveBeenCalledWith("pipe-b", expect.any(Function));
  });

  it("always calls the latest refresh callback without resubscribing when refresh's identity changes", () => {
    mockUseOutputMeta.mockReturnValue({ output: makeOutput(), isLoading: false });
    let deliveredCallback: (() => void) | undefined;
    mockSubscribe.mockImplementation((_pipelineId, onSucceeded) => {
      deliveredCallback = onSucceeded;
      return jest.fn();
    });
    const refresh1 = jest.fn();
    const refresh2 = jest.fn();

    const { rerender } = renderHook(({ refresh }) => usePanelRunRefresh("out-1", refresh), {
      initialProps: { refresh: refresh1 },
    });

    rerender({ refresh: refresh2 });

    // Still exactly one subscription — the identity change didn't reopen the connection.
    expect(mockSubscribe).toHaveBeenCalledTimes(1);

    deliveredCallback?.();

    expect(refresh1).not.toHaveBeenCalled();
    expect(refresh2).toHaveBeenCalledTimes(1);
  });
});
