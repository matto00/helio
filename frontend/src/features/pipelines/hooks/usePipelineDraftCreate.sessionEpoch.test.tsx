// HEL-1810: a draft AI step's create that resolves after sign-out does not flush an in-flight edit.
import { act, renderHook } from "@testing-library/react";

import { clearAuth } from "../../auth/state/authSlice";
import { store } from "../../../store/store";
import { createPipelineStep, updatePipelineStep } from "../services/pipelineService";
import { deferred, flushPromises } from "./sessionEpochTestKit";
import { usePipelineDraftCreate } from "./usePipelineDraftCreate";

jest.mock("../services/pipelineService");

const COMPLETE = {
  inputField: "a",
  instruction: "do it",
  outputSchema: [{ name: "b", type: "string" }],
} as never;
// A new object: an edit that landed while the create was in flight.
const EDITED = { ...(COMPLETE as object), instruction: "edited" } as never;

function setup() {
  const stepsRef = {
    current: [{ id: "tmp-1", opType: { id: "analyzewithai" }, config: COMPLETE }] as never[],
  };
  const applyCreated = jest.fn();
  const hook = renderHook(() =>
    usePipelineDraftCreate({
      id: "pipe-A",
      stepsRef: stepsRef as never,
      applyCreated,
      pendingDraftMetaRef: { current: new Map([["tmp-1", {}]]) },
      draftFallbackMetaRef: { current: new Map() },
      syncPendingDraftIds: jest.fn(),
      creatingDraftIdsRef: { current: new Set() },
      setDraftCreateErrors: jest.fn(),
    }),
  );
  return { hook, stepsRef, applyCreated };
}

beforeEach(() => {
  jest.resetAllMocks();
  act(() => {
    store.dispatch(clearAuth());
  });
});

describe("createDraftIfComplete", () => {
  it("flushes the in-flight edit in the same session (control)", async () => {
    const created = deferred<never>();
    jest.mocked(createPipelineStep).mockReturnValue(created.promise);
    jest.mocked(updatePipelineStep).mockResolvedValue(undefined as never);
    const { hook, stepsRef, applyCreated } = setup();
    act(() => {
      hook.result.current("tmp-1", COMPLETE);
    });
    stepsRef.current = [{ ...(stepsRef.current[0] as object), config: EDITED }] as never[];
    await act(async () => {
      created.resolve({ id: "step-real" } as never);
      await flushPromises();
    });
    expect(applyCreated).toHaveBeenCalled();
    expect(updatePipelineStep).toHaveBeenCalledWith("step-real", EDITED);
  });

  it("does not flush the in-flight edit when the session ends during the create", async () => {
    const created = deferred<never>();
    jest.mocked(createPipelineStep).mockReturnValue(created.promise);
    jest.mocked(updatePipelineStep).mockResolvedValue(undefined as never);
    const { hook, stepsRef } = setup();
    act(() => {
      hook.result.current("tmp-1", COMPLETE);
    });
    stepsRef.current = [{ ...(stepsRef.current[0] as object), config: EDITED }] as never[];
    act(() => {
      store.dispatch(clearAuth());
    });
    await act(async () => {
      created.resolve({ id: "step-real" } as never);
      await flushPromises();
    });
    expect(updatePipelineStep).not.toHaveBeenCalled();
  });
});
