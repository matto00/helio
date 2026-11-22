// HEL-1810: applying a shape stops (and stays silent) when the session ends mid-loop.
import { act, renderHook } from "@testing-library/react";

import { clearAuth } from "../../auth/state/authSlice";
import { store } from "../../../store/store";
import { createOutput } from "../services/outputService";
import { createPipelineStep } from "../services/pipelineService";
import { deferred, flushPromises } from "./sessionEpochTestKit";
import { usePipelineShapeInstantiation } from "./usePipelineShapeInstantiation";

jest.mock("../services/pipelineService");
jest.mock("../services/outputService");

const EXPANSION = {
  steps: [
    { clientId: "c1", kind: "filter", config: {} },
    { clientId: "c2", kind: "filter", config: {}, parentStepId: "c1" },
  ],
  outputs: [{ nodeStepId: "c2", kind: "table" }],
} as never;

function setup() {
  const applyCreated = jest.fn();
  const pushToast = jest.fn();
  const hook = renderHook(() =>
    usePipelineShapeInstantiation({
      id: "pipe-A",
      roots: [],
      applyCreated,
      setStepsInitialized: jest.fn(),
      pushToast: pushToast as never,
    }),
  );
  return { hook, pushToast };
}

beforeEach(() => {
  jest.resetAllMocks();
  act(() => {
    store.dispatch(clearAuth());
  });
});

describe("handleInstantiateShape", () => {
  it("creates every step and Output in the same session (control)", async () => {
    jest.mocked(createPipelineStep).mockResolvedValue({ id: "real" } as never);
    jest.mocked(createOutput).mockResolvedValue({ id: "o" } as never);
    const { hook } = setup();
    await act(async () => {
      await hook.result.current(EXPANSION, "anchor");
    });
    expect(createPipelineStep).toHaveBeenCalledTimes(2);
    expect(createOutput).toHaveBeenCalledTimes(1);
  });

  it("sends no further create when the session ends during the first step create", async () => {
    const first = deferred<never>();
    jest.mocked(createPipelineStep).mockReturnValueOnce(first.promise);
    jest.mocked(createPipelineStep).mockResolvedValue({ id: "real" } as never);
    jest.mocked(createOutput).mockResolvedValue({ id: "o" } as never);
    const { hook } = setup();
    let done: Promise<unknown> = Promise.resolve();
    act(() => {
      done = hook.result.current(EXPANSION, "anchor");
    });
    act(() => {
      store.dispatch(clearAuth());
    });
    await act(async () => {
      first.resolve({ id: "real" } as never);
      await done;
    });
    expect(createPipelineStep).toHaveBeenCalledTimes(1);
    expect(createOutput).not.toHaveBeenCalled();
  });

  it("sends no Output create when the session ends during the last step create", async () => {
    const second = deferred<never>();
    jest.mocked(createPipelineStep).mockResolvedValueOnce({ id: "real" } as never);
    jest.mocked(createPipelineStep).mockReturnValueOnce(second.promise);
    jest.mocked(createOutput).mockResolvedValue({ id: "o" } as never);
    const { hook } = setup();
    let done: Promise<unknown> = Promise.resolve();
    act(() => {
      done = hook.result.current(EXPANSION, "anchor");
    });
    await act(async () => {
      await flushPromises();
    });
    act(() => {
      store.dispatch(clearAuth());
    });
    await act(async () => {
      second.resolve({ id: "real2" } as never);
      await done;
    });
    expect(createOutput).not.toHaveBeenCalled();
  });

  it("sends no further Output create when the session ends during an Output create", async () => {
    const two = {
      steps: [{ clientId: "c1", kind: "filter", config: {} }],
      outputs: [
        { nodeStepId: "c1", kind: "table" },
        { nodeStepId: "c1", kind: "table", name: "second" },
      ],
    } as never;
    const firstOut = deferred<never>();
    jest.mocked(createPipelineStep).mockResolvedValue({ id: "real" } as never);
    jest.mocked(createOutput).mockReturnValueOnce(firstOut.promise);
    jest.mocked(createOutput).mockResolvedValue({ id: "o2" } as never);
    const { hook } = setup();
    let done: Promise<unknown> = Promise.resolve();
    act(() => {
      done = hook.result.current(two, "anchor");
    });
    await act(async () => {
      await flushPromises();
    });
    act(() => {
      store.dispatch(clearAuth());
    });
    await act(async () => {
      firstOut.resolve({ id: "o1" } as never);
      await done;
    });
    expect(createOutput).toHaveBeenCalledTimes(1);
  });

  it("creates both Outputs in the same session (control)", async () => {
    const two = {
      steps: [{ clientId: "c1", kind: "filter", config: {} }],
      outputs: [
        { nodeStepId: "c1", kind: "table" },
        { nodeStepId: "c1", kind: "table", name: "second" },
      ],
    } as never;
    jest.mocked(createPipelineStep).mockResolvedValue({ id: "real" } as never);
    jest.mocked(createOutput).mockResolvedValue({ id: "o" } as never);
    const { hook } = setup();
    await act(async () => {
      await hook.result.current(two, "anchor");
    });
    expect(createOutput).toHaveBeenCalledTimes(2);
  });

  it("toasts a failure in the same session (control)", async () => {
    jest.mocked(createPipelineStep).mockRejectedValue(new Error("boom"));
    const { hook, pushToast } = setup();
    await act(async () => {
      await hook.result.current(EXPANSION, "anchor");
    });
    expect(pushToast).toHaveBeenCalledTimes(1);
  });

  it("does not toast a rejection that arrives after sign-out", async () => {
    const first = deferred<never>();
    jest.mocked(createPipelineStep).mockReturnValue(first.promise);
    const { hook, pushToast } = setup();
    let done: Promise<unknown> = Promise.resolve();
    act(() => {
      done = hook.result.current(EXPANSION, "anchor");
    });
    act(() => {
      store.dispatch(clearAuth());
    });
    await act(async () => {
      first.reject(new Error("session revoked"));
      await done;
    });
    expect(pushToast).not.toHaveBeenCalled();
  });
});
