// HEL-1798: duplicate step, add root and remove root do not resync after sign-out.
import { act, renderHook } from "@testing-library/react";

import { clearAuth } from "../../auth/state/authSlice";
import { store } from "../../../store/store";
import {
  addPipelineRoot,
  duplicatePipelineStep,
  getPipelineById,
  removePipelineRoot,
} from "../services/pipelineService";
import { deferred, flushPromises } from "./sessionEpochTestKit";
import { usePipelineRootAndToggleActions } from "./usePipelineRootAndToggleActions";

jest.mock("../services/pipelineService");

function setup() {
  const syncStepsFromServer = jest.fn().mockResolvedValue(undefined);
  const rendered = renderHook(() =>
    usePipelineRootAndToggleActions({
      id: "pipe-A",
      dispatch: store.dispatch,
      stepsRef: { current: [] },
      setSteps: jest.fn(),
      pushToast: jest.fn() as never,
      syncStepsFromServer,
    }),
  );
  return { rendered, syncStepsFromServer };
}

function signOut() {
  act(() => {
    store.dispatch(clearAuth());
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  signOut();
});

describe("usePipelineRootAndToggleActions after sign-out", () => {
  it("duplicate step does not resync the steps", async () => {
    const dup = deferred<never>();
    jest.mocked(duplicatePipelineStep).mockReturnValue(dup.promise);
    const { rendered, syncStepsFromServer } = setup();
    act(() => {
      rendered.result.current.handleDuplicateStep("s1");
    });
    signOut();
    await act(async () => {
      dup.resolve({} as never);
      await flushPromises();
    });
    expect(syncStepsFromServer).not.toHaveBeenCalled();
  });

  it("add root does not refetch the pipeline", async () => {
    const add = deferred<never>();
    jest.mocked(addPipelineRoot).mockReturnValue(add.promise);
    const { rendered } = setup();
    let done: Promise<unknown> = Promise.resolve();
    act(() => {
      done = rendered.result.current.handleAddRoot("src-1");
    });
    signOut();
    await act(async () => {
      add.resolve({} as never);
      await done;
      await flushPromises();
    });
    expect(getPipelineById).not.toHaveBeenCalled();
  });

  it("remove root does not refetch the pipeline or resync the steps", async () => {
    const rem = deferred<never>();
    jest.mocked(removePipelineRoot).mockReturnValue(rem.promise);
    const { rendered, syncStepsFromServer } = setup();
    let done: Promise<unknown> = Promise.resolve();
    act(() => {
      done = rendered.result.current.handleRemoveRoot("root-1");
    });
    signOut();
    await act(async () => {
      rem.resolve({ removedStepCount: 0, removedOutputCount: 0 } as never);
      await done;
      await flushPromises();
    });
    expect(getPipelineById).not.toHaveBeenCalled();
    expect(syncStepsFromServer).not.toHaveBeenCalled();
  });
});
