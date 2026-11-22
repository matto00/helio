// HEL-1798: "add as tail with aggregate" does not continue (resync, create the Output, refresh, preview) after sign-out.
import { act, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

import { clearAuth } from "../../auth/state/authSlice";
import { store } from "../../../store/store";
import { createOutput, listOutputs, previewOutputs } from "../services/outputService";
import {
  createPipelineStep,
  deletePipelineStep,
  getPipelineSteps,
} from "../services/pipelineService";
import { deferred, flushPromises } from "./sessionEpochTestKit";
import { usePipelineStepStructure } from "./usePipelineStepStructure";

jest.mock("../services/pipelineService");
jest.mock("../services/outputService");

const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;

const AGG = { groupBy: [], aggregations: [] } as never;
const PAYLOAD = { kind: "table", name: "n", config: {} };
const STEP = { id: "step-new" } as never;
const OUTPUT = { id: "out-new" } as never;

function setup(setSteps: jest.Mock = jest.fn()) {
  return renderHook(
    () =>
      usePipelineStepStructure({
        id: "pipe-A",
        dispatch: store.dispatch,
        roots: [],
        stepsRef: { current: [] },
        setSteps,
        setStepsInitialized: jest.fn(),
        pushToast: jest.fn() as never,
        pendingDraftMetaRef: { current: new Map() },
        setPendingDraftIds: jest.fn(),
        draftFallbackMetaRef: { current: new Map() },
      }),
    { wrapper },
  );
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

describe("handleAddOutputViaAggregateTail after sign-out", () => {
  it("does not resync, create the Output or roll back when the session ends during createPipelineStep", async () => {
    const created = deferred<never>();
    jest.mocked(createPipelineStep).mockReturnValue(created.promise);
    const { result } = setup();
    let settled: Promise<unknown> = Promise.resolve();
    act(() => {
      settled = result.current.handleAddOutputViaAggregateTail("p", AGG, PAYLOAD).catch(() => {});
    });
    signOut();
    await act(async () => {
      created.resolve(STEP);
      await settled;
    });
    expect(getPipelineSteps).not.toHaveBeenCalled();
    expect(createOutput).not.toHaveBeenCalled();
    expect(deletePipelineStep).not.toHaveBeenCalled();
  });

  it("does not create the Output (or roll back) when the session ends during the resync", async () => {
    jest.mocked(createPipelineStep).mockResolvedValue(STEP);
    const steps = deferred<never[]>();
    jest.mocked(getPipelineSteps).mockReturnValue(steps.promise);
    const { result } = setup();
    let settled: Promise<unknown> = Promise.resolve();
    act(() => {
      settled = result.current.handleAddOutputViaAggregateTail("p", AGG, PAYLOAD).catch(() => {});
    });
    await act(async () => {
      await flushPromises();
    });
    signOut();
    await act(async () => {
      steps.resolve([]);
      await settled;
    });
    expect(createOutput).not.toHaveBeenCalled();
    expect(deletePipelineStep).not.toHaveBeenCalled();
  });

  it("does not refetch Outputs or preview the new Output when the session ends during createOutput", async () => {
    jest.mocked(createPipelineStep).mockResolvedValue(STEP);
    jest.mocked(getPipelineSteps).mockResolvedValue([]);
    const out = deferred<never>();
    jest.mocked(createOutput).mockReturnValue(out.promise);
    const { result } = setup();
    let settled: Promise<unknown> = Promise.resolve();
    act(() => {
      settled = result.current.handleAddOutputViaAggregateTail("p", AGG, PAYLOAD).catch(() => {});
    });
    await act(async () => {
      await flushPromises();
    });
    signOut();
    await act(async () => {
      out.resolve(OUTPUT);
      await settled;
    });
    expect(listOutputs).not.toHaveBeenCalled();
    expect(previewOutputs).not.toHaveBeenCalled();
    expect(deletePipelineStep).not.toHaveBeenCalled();
  });

  it("does not send the rollback delete when createOutput rejects after sign-out", async () => {
    jest.mocked(createPipelineStep).mockResolvedValue(STEP);
    jest.mocked(getPipelineSteps).mockResolvedValue([]);
    const out = deferred<never>();
    jest.mocked(createOutput).mockReturnValue(out.promise);
    const { result } = setup();
    let settled: Promise<unknown> = Promise.resolve();
    act(() => {
      settled = result.current.handleAddOutputViaAggregateTail("p", AGG, PAYLOAD).catch(() => {});
    });
    await act(async () => {
      await flushPromises();
    });
    signOut();
    await act(async () => {
      out.reject(new Error("session revoked"));
      await settled;
    });
    expect(deletePipelineStep).not.toHaveBeenCalled();
  });
});

describe("handleAddOutputViaAggregateTail rollback in the same session", () => {
  it("removes the orphaned step locally and deletes it when createOutput rejects", async () => {
    jest.mocked(createPipelineStep).mockResolvedValue(STEP);
    jest.mocked(getPipelineSteps).mockResolvedValue([]);
    jest.mocked(createOutput).mockRejectedValue(new Error("create failed"));
    jest.mocked(deletePipelineStep).mockResolvedValue(undefined as never);
    const setSteps = jest.fn();
    const { result } = setup(setSteps);
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current
        .handleAddOutputViaAggregateTail("p", AGG, PAYLOAD)
        .catch((err: unknown) => err);
      await flushPromises();
    });
    expect(outcome).toEqual(new Error("create failed"));
    expect(deletePipelineStep).toHaveBeenCalledWith("step-new");
    const filter = setSteps.mock.calls
      .map(([arg]) => arg)
      .filter(
        (arg): arg is (prev: { id: string }[]) => { id: string }[] => typeof arg === "function",
      )
      .pop();
    expect(filter?.([{ id: "step-new" }, { id: "keep" }])).toEqual([{ id: "keep" }]);
  });
});
