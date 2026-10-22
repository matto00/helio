// HEL-1685 (item 7): the run's terminal event can arrive before the Save & run response is processed, when the page still
// holds the pre-save Output list. The save's own settle refreshes the previews from the saved definition, so the terminal
// handler must leave them alone while a draft save is in flight.

import { renderHook } from "@testing-library/react";

import { usePipelineRunStream } from "./usePipelineRunStream";
import type { RunStatusEventData } from "./usePipelineRunEvents";

let onTerminal: (event: RunStatusEventData) => void = () => undefined;
jest.mock("./usePipelineRunEvents", () => ({
  usePipelineRunEvents: (args: { onTerminal: (event: RunStatusEventData) => void }) => {
    onTerminal = args.onTerminal;
    return { status: null };
  },
}));
jest.mock("../state/outputsSlice", () => ({
  previewOutput: (arg: { outputId: string }) => ({ type: "preview", outputId: arg.outputId }),
  resetRunScopedState: () => ({ type: "reset" }),
  selectOutputsForPipeline: (state: { outputs: { id: string }[] }) => state.outputs,
}));

// The store already lost "removed" (outputsReplaced) before the page re-rendered.
const storeState = { outputs: [{ id: "kept" }] };

function setup(inFlight: boolean) {
  const dispatch: jest.Mock = jest.fn((action: unknown) =>
    typeof action === "function" ? action(dispatch, () => storeState) : action,
  );
  renderHook(() =>
    usePipelineRunStream({
      id: "p1",
      dispatch: dispatch as never,
      sseActive: true,
      setSseActive: jest.fn(),
      draftSaveInFlightRef: { current: inFlight },
      refreshRunHistoryAfterRun: jest.fn(),
    }),
  );
  return dispatch;
}

const previewed = (dispatch: jest.Mock) =>
  dispatch.mock.calls.map(([a]) => a).filter((a) => a.type === "preview");

describe("usePipelineRunStream terminal refresh", () => {
  it("refreshes the Outputs the store holds when a run ends, never one a save already removed, even if the last render still listed it", () => {
    const dispatch = setup(false);
    onTerminal({ status: "succeeded" });
    expect(previewed(dispatch).map((a) => a.outputId)).toEqual(["kept"]);
  });

  it("requests no preview while a draft save is in flight (the save refreshes from its own definition), but still resets", () => {
    const dispatch = setup(true);
    onTerminal({ status: "succeeded" });
    expect(previewed(dispatch)).toEqual([]);
    expect(dispatch).toHaveBeenCalledWith({ type: "reset" });
  });
});
