// HEL-1798: the page-open fetches' continuations do nothing once the session has ended (`clearAuth`).
import { act, renderHook } from "@testing-library/react";

import { clearAuth } from "../../auth/state/authSlice";
import { store } from "../../../store/store";
import { listOutputs } from "../services/outputService";
import { analyzePipeline, getPipelineSteps } from "../services/pipelineService";
import { deferred, flushPromises } from "./sessionEpochTestKit";
import { usePipelinePageLoad } from "./usePipelinePageLoad";

jest.mock("../services/pipelineService");
jest.mock("../services/outputService");

function setup() {
  const onStepsSettled = jest.fn();
  const onOutputsSettled = jest.fn();
  const onStepsRetry = jest.fn();
  const analyzeStatusRef = { current: "failed" as "failed" | null };
  const rendered = renderHook(() =>
    usePipelinePageLoad({
      id: "pipe-A",
      dispatch: store.dispatch,
      currentPipeline: null,
      singletonIsOwn: false,
      currentPipelineStatus: "idle",
      sourcesStatus: "succeeded",
      loadRunHistoryWhenTruncated: jest.fn(),
      onStepsSettled,
      onStepsRetry,
      onOutputsSettled,
      analyzeStatusRef,
    }),
  );
  return { rendered, onStepsSettled, onOutputsSettled };
}

beforeEach(() => {
  jest.resetAllMocks();
  act(() => {
    store.dispatch(clearAuth());
  });
});

describe("usePipelinePageLoad after sign-out", () => {
  it("does not run the steps/Outputs settle callbacks of the mount fetches", async () => {
    const steps = deferred<never[]>();
    const outputs = deferred<never[]>();
    jest.mocked(getPipelineSteps).mockReturnValue(steps.promise);
    jest.mocked(listOutputs).mockReturnValue(outputs.promise);
    const { onStepsSettled, onOutputsSettled } = setup();
    act(() => {
      store.dispatch(clearAuth());
    });
    await act(async () => {
      steps.resolve([]);
      outputs.resolve([]);
      await flushPromises();
    });
    expect(onStepsSettled).not.toHaveBeenCalled();
    expect(onOutputsSettled).not.toHaveBeenCalled();
  });

  it("retryStepsLoad does not settle or re-request analyze", async () => {
    jest.mocked(getPipelineSteps).mockResolvedValue([]);
    jest.mocked(listOutputs).mockResolvedValue([]);
    const { rendered, onStepsSettled } = setup();
    await act(async () => {
      await flushPromises();
    });
    onStepsSettled.mockClear();
    jest.mocked(analyzePipeline).mockClear();
    const retry = deferred<never[]>();
    jest.mocked(getPipelineSteps).mockReturnValue(retry.promise);
    act(() => {
      rendered.result.current.retryStepsLoad();
    });
    act(() => {
      store.dispatch(clearAuth());
    });
    await act(async () => {
      retry.resolve([]);
      await flushPromises();
    });
    expect(onStepsSettled).not.toHaveBeenCalled();
    expect(analyzePipeline).not.toHaveBeenCalled();
  });
});
