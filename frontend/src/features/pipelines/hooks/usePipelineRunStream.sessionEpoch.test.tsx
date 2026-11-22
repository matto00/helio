// HEL-1810: a live run's stream that ends after sign-out resets, previews and refreshes nothing.
import { act, renderHook } from "@testing-library/react";

import { clearAuth } from "../../auth/state/authSlice";
import { store } from "../../../store/store";
import { outputsReplaced } from "../state/outputsSlice";
import { previewOutputs } from "../services/outputService";
import { usePipelineRunEvents } from "./usePipelineRunEvents";
import { usePipelineRunStream } from "./usePipelineRunStream";

jest.mock("./usePipelineRunEvents");
jest.mock("../services/outputService");

function setup() {
  const refreshRunHistoryAfterRun = jest.fn();
  const setSseActive = jest.fn();
  const dispatch = jest.fn(store.dispatch) as unknown as typeof store.dispatch;
  jest.mocked(usePipelineRunEvents).mockReturnValue({} as never);
  renderHook(() =>
    usePipelineRunStream({
      id: "pipe-A",
      dispatch,
      sseActive: true,
      setSseActive,
      draftSaveInFlightRef: { current: false },
      refreshRunHistoryAfterRun,
    }),
  );
  const onTerminal = jest.mocked(usePipelineRunEvents).mock.calls[0][0].onTerminal!;
  return { onTerminal, dispatch, refreshRunHistoryAfterRun, setSseActive };
}

function seedOutput() {
  act(() => {
    store.dispatch(clearAuth());
    store.dispatch(outputsReplaced({ pipelineId: "pipe-A", outputs: [{ id: "out-1" } as never] }));
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(previewOutputs).mockResolvedValue({ outputs: [] } as never);
});

describe("usePipelineRunStream onTerminal", () => {
  it("resets, previews and refreshes history in the same session (control)", () => {
    seedOutput();
    const { onTerminal, dispatch, refreshRunHistoryAfterRun, setSseActive } = setup();
    (dispatch as unknown as jest.Mock).mockClear();
    act(() => {
      onTerminal({ status: "succeeded" } as never);
    });
    expect(setSseActive).toHaveBeenCalledWith(false);
    expect(refreshRunHistoryAfterRun).toHaveBeenCalledTimes(1);
    // reset action + the preview-fan-out thunk + the per-Output preview thunk it dispatches
    expect(dispatch).toHaveBeenCalledTimes(3);
    expect(previewOutputs).toHaveBeenCalledWith("pipe-A", "out-1");
  });

  it("dispatches and refreshes nothing when the session ended before the terminal event", () => {
    seedOutput();
    const { onTerminal, dispatch, refreshRunHistoryAfterRun, setSseActive } = setup();
    act(() => {
      store.dispatch(clearAuth());
    });
    (dispatch as unknown as jest.Mock).mockClear();
    act(() => {
      onTerminal({ status: "succeeded" } as never);
    });
    expect(setSseActive).toHaveBeenCalledWith(false);
    expect(dispatch).not.toHaveBeenCalled();
    expect(refreshRunHistoryAfterRun).not.toHaveBeenCalled();
    expect(previewOutputs).not.toHaveBeenCalled();
  });
});
