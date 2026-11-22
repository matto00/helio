// HEL-1810: an undo that continues after sign-out dismisses no toast, reloads nothing, adopts nothing.
import { act, renderHook } from "@testing-library/react";

import { clearAuth } from "../../auth/state/authSlice";
import { store } from "../../../store/store";
import { undoPatchSet } from "../../patchSets/services/patchSetService";
import { getPipelineWithDefinition } from "../services/draftSaveService";
import { getPipelineById } from "../services/pipelineService";
import { deferred, flushPromises } from "./sessionEpochTestKit";
import { usePipelineDraftUndo } from "./usePipelineDraftUndo";

jest.mock("../../patchSets/services/patchSetService");
jest.mock("../services/draftSaveService");
jest.mock("../services/pipelineService");

function setup() {
  const dispatch = jest.fn(store.dispatch) as unknown as typeof store.dispatch;
  const adoptDefinition = jest.fn();
  const pushToast = jest.fn();
  const discard = jest.fn();
  const hook = renderHook(() =>
    usePipelineDraftUndo({
      id: "pipe-A",
      dispatch,
      draft: { discard, overlayRef: { current: undefined } } as never,
      pushToast: pushToast as never,
      mountedRef: { current: true },
      setNotice: jest.fn(),
      adoptDefinition,
    }),
  );
  hook.result.current.savedToastRef.current = { toastId: "t1", applicationId: "app-1" };
  return { hook, dispatch, adoptDefinition, pushToast };
}

function dispatchedTypes(dispatch: typeof store.dispatch): string[] {
  return (dispatch as unknown as jest.Mock).mock.calls.map(([a]) =>
    typeof a === "function" ? "thunk" : (a as { type: string }).type,
  );
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(getPipelineById).mockResolvedValue({ id: "pipe-A" } as never);
  act(() => {
    store.dispatch(clearAuth());
  });
});

describe("undo", () => {
  it("dismisses the toast, reloads, adopts and toasts in the same session (control)", async () => {
    jest.mocked(undoPatchSet).mockResolvedValue(undefined as never);
    jest.mocked(getPipelineWithDefinition).mockResolvedValue({
      definition: { steps: [], outputs: [] },
      roots: [],
    } as never);
    const { hook, dispatch, adoptDefinition, pushToast } = setup();
    await act(async () => {
      await hook.result.current.confirmUndoWithDraft("app-1");
      await flushPromises();
    });
    expect(dispatchedTypes(dispatch)).toContain("toasts/dismissToast");
    expect(getPipelineWithDefinition).toHaveBeenCalledWith("pipe-A");
    expect(adoptDefinition).toHaveBeenCalled();
    expect(dispatchedTypes(dispatch)).toContain("thunk");
    expect(getPipelineById).toHaveBeenCalledWith("pipe-A");
    expect(pushToast).toHaveBeenCalledWith({ variant: "success", message: "Undone." });
  });

  it("does not dismiss the toast or reload when the session ends during undoPatchSet", async () => {
    const undone = deferred<never>();
    jest.mocked(undoPatchSet).mockReturnValue(undone.promise);
    jest.mocked(getPipelineWithDefinition).mockResolvedValue({ roots: [] } as never);
    const { hook, dispatch } = setup();
    let done: Promise<unknown> = Promise.resolve();
    act(() => {
      done = Promise.resolve(hook.result.current.confirmUndoWithDraft("app-1"));
    });
    act(() => {
      store.dispatch(clearAuth());
    });
    (dispatch as unknown as jest.Mock).mockClear();
    await act(async () => {
      undone.resolve(undefined as never);
      await done;
      await flushPromises();
    });
    expect(dispatchedTypes(dispatch)).not.toContain("toasts/dismissToast");
    expect(getPipelineWithDefinition).not.toHaveBeenCalled();
    expect(getPipelineById).not.toHaveBeenCalled();
  });

  it("adopts, refetches and toasts nothing when the session ends during getPipelineWithDefinition", async () => {
    jest.mocked(undoPatchSet).mockResolvedValue(undefined as never);
    const loaded = deferred<never>();
    jest.mocked(getPipelineWithDefinition).mockReturnValue(loaded.promise);
    const { hook, dispatch, adoptDefinition, pushToast } = setup();
    act(() => {
      void hook.result.current.confirmUndoWithDraft("app-1");
    });
    await act(async () => {
      await flushPromises();
    });
    act(() => {
      store.dispatch(clearAuth());
    });
    (dispatch as unknown as jest.Mock).mockClear();
    await act(async () => {
      loaded.resolve({ definition: { steps: [], outputs: [] }, roots: [] } as never);
      await flushPromises();
    });
    expect(adoptDefinition).not.toHaveBeenCalled();
    expect(getPipelineById).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(pushToast).not.toHaveBeenCalled();
  });
});
