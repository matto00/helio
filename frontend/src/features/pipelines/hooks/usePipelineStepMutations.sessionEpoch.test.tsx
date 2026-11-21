// HEL-1798: removing a step does not resync the steps after sign-out.
import { act, renderHook } from "@testing-library/react";

import { clearAuth } from "../../auth/state/authSlice";
import { store } from "../../../store/store";
import { deletePipelineStep } from "../services/pipelineService";
import { deferred, flushPromises } from "./sessionEpochTestKit";
import { usePipelineStepMutations } from "./usePipelineStepMutations";

jest.mock("../services/pipelineService");

describe("usePipelineStepMutations.handleRemoveStep after sign-out", () => {
  it("does not resync the steps", async () => {
    jest.resetAllMocks();
    act(() => {
      store.dispatch(clearAuth());
    });
    const del = deferred<undefined>();
    jest.mocked(deletePipelineStep).mockReturnValue(del.promise);
    const syncStepsFromServer = jest.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      usePipelineStepMutations({
        id: "pipe-A",
        roots: [],
        stepsRef: { current: [] },
        setSteps: jest.fn(),
        pushToast: jest.fn() as never,
        clearDraftCreateError: jest.fn(),
        createDraftIfComplete: jest.fn(),
        markTempRemoved: jest.fn(),
        syncStepsFromServer,
      }),
    );
    act(() => {
      result.current.handleRemoveStep("real-step-id");
    });
    act(() => {
      store.dispatch(clearAuth());
    });
    await act(async () => {
      del.resolve(undefined);
      await flushPromises();
    });
    expect(syncStepsFromServer).not.toHaveBeenCalled();
  });
});
