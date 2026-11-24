// HEL-1798: Save & run and "Reload the saved pipeline" dispatch nothing and issue no request after sign-out.
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";

import { clearAuth } from "../../auth/state/authSlice";
import { store } from "../../../store/store";
import { getPipelineWithDefinition, saveDraft } from "../services/draftSaveService";
import { getPipelineById } from "../services/pipelineService";
import { EMPTY_OVERLAY } from "../state/pipelineDraft";
import { pipelineStepToStep } from "../state/stepNarrowing";
import { threeSteps } from "../ui/pipelineSpineTestKit";
import type { PipelineDraft } from "./usePipelineDraft";
import { usePipelineDraftSave } from "./usePipelineDraftSave";
import { deferred, flushPromises } from "./sessionEpochTestKit";

jest.mock("../services/draftSaveService", () => ({
  ...jest.requireActual("../services/draftSaveService"),
  getPipelineWithDefinition: jest.fn(),
  saveDraft: jest.fn(),
}));

jest.mock("../services/pipelineService");

const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;

function summary() {
  return {
    id: "pipe-A",
    fingerprint: "v1:" + "a".repeat(64),
    definition: { steps: threeSteps(), outputs: [] },
    roots: [],
  } as never;
}

function setup() {
  const steps = threeSteps().map(pipelineStepToStep);
  const draft = {
    overlayRef: {
      current: {
        ...EMPTY_OVERLAY,
        ops: [
          {
            kind: "insert",
            clientId: "draft-1",
            type: "limit",
            config: { count: 1 },
            anchor: { after: "s1" },
          },
        ],
      },
    },
    staleRestoredRef: { current: false },
    staleRestored: false,
    draftSteps: steps,
    draftOutputs: [],
    droppedCount: 0,
    clearDropped: jest.fn(),
    discard: jest.fn(),
    rebase: jest.fn(),
  } as unknown as PipelineDraft;
  const dispatch = jest.fn(store.dispatch) as unknown as typeof store.dispatch;
  const rendered = renderHook(
    () =>
      usePipelineDraftSave({
        id: "pipe-A",
        dispatch,
        pushToast: jest.fn() as never,
        draft,
        stepsRef: { current: steps },
        setSteps: jest.fn(),
        roots: [],
        allOutputsRef: { current: [] },
        draftSaveInFlightRef: { current: false },
        setOutputPickRemap: jest.fn(),
        outputsLoaded: false,
        setSseActive: jest.fn(),
        refreshRunHistoryAfterRun: jest.fn(),
        refreshVisibleOutputPreviews: jest.fn(),
        runRole: "owner",
      }),
    { wrapper },
  );
  return { rendered, dispatch, draft };
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

describe("usePipelineDraftSave after sign-out", () => {
  it("posts nothing and marks no run pending when the session ends while the saved pipeline is read", async () => {
    const read = deferred<never>();
    jest.mocked(getPipelineWithDefinition).mockReturnValue(read.promise);
    const { rendered, dispatch } = setup();
    let posted: Promise<unknown> = Promise.resolve();
    act(() => {
      posted = rendered.result.current.saveAndRun();
    });
    signOut();
    await act(async () => {
      read.resolve(summary());
      await posted;
    });
    expect(saveDraft).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("settles nothing when the save response arrives after sign-out", async () => {
    jest.mocked(getPipelineWithDefinition).mockResolvedValue(summary());
    const save = deferred<never>();
    jest.mocked(saveDraft).mockReturnValue(save.promise);
    const { rendered, dispatch, draft } = setup();
    let posted: Promise<unknown> = Promise.resolve();
    act(() => {
      posted = rendered.result.current.saveAndRun();
    });
    await act(async () => {
      await flushPromises();
    });
    expect(saveDraft).toHaveBeenCalledTimes(1);
    signOut();
    (dispatch as unknown as jest.Mock).mockClear();
    await act(async () => {
      save.resolve({
        saved: { applicationId: "app-1", definition: { steps: [], outputs: [] } },
        run: { started: true, status: "succeeded" },
      } as never);
      await posted;
    });
    expect(dispatch).not.toHaveBeenCalled();
    expect(draft.discard).not.toHaveBeenCalled();
    expect(getPipelineById).not.toHaveBeenCalled();
  });

  it("does not dispatch a failed settle when the save fails after sign-out", async () => {
    jest.mocked(getPipelineWithDefinition).mockResolvedValue(summary());
    const save = deferred<never>();
    jest.mocked(saveDraft).mockReturnValue(save.promise);
    const { rendered, dispatch } = setup();
    let posted: Promise<unknown> = Promise.resolve();
    act(() => {
      posted = rendered.result.current.saveAndRun();
    });
    await act(async () => {
      await flushPromises();
    });
    signOut();
    (dispatch as unknown as jest.Mock).mockClear();
    await act(async () => {
      save.reject(new Error("network"));
      await posted;
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("reload adopts nothing when the session ends while the saved pipeline is read", async () => {
    const read = deferred<never>();
    jest.mocked(getPipelineWithDefinition).mockReturnValue(read.promise);
    const { rendered, dispatch, draft } = setup();
    let reloaded: Promise<unknown> = Promise.resolve();
    act(() => {
      reloaded = rendered.result.current.reload();
    });
    signOut();
    await act(async () => {
      read.resolve(summary());
      await reloaded;
    });
    expect(dispatch).not.toHaveBeenCalled();
    expect(draft.rebase).not.toHaveBeenCalled();
  });
});
