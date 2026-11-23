// HEL-1798: a run or dry run that finishes after sign-out refreshes neither run history nor previews.
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { Provider } from "react-redux";

import { clearAuth } from "../../auth/state/authSlice";
import { store } from "../../../store/store";
import { runPipeline } from "../services/pipelineService";
import { deferred, flushPromises } from "./sessionEpochTestKit";
import { usePipelineRunAndSaveActions } from "./usePipelineRunAndSaveActions";

jest.mock("../services/pipelineService");
jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useNavigate: () => jest.fn(),
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>{children}</Provider>
);

function setup() {
  const refreshRunHistoryAfterRun = jest.fn();
  const dispatch = jest.fn(store.dispatch) as unknown as typeof store.dispatch;
  const rendered = renderHook(
    () =>
      usePipelineRunAndSaveActions({
        id: "pipe-A",
        dispatch,
        navigate: jest.fn() as never,
        setSseActive: jest.fn(),
        allOutputsRef: { current: [{ id: "out-1" } as never] },
        refreshRunHistoryAfterRun,
        outputName: "n",
        isDirty: false,
        setIsConfirmingCancel: jest.fn(),
        runRole: "owner",
        canEdit: true,
      }),
    { wrapper },
  );
  return { rendered, refreshRunHistoryAfterRun, dispatch };
}

beforeEach(() => {
  jest.resetAllMocks();
  act(() => {
    store.dispatch(clearAuth());
  });
});

describe.each(["handleRunPipeline", "handleDryRun"] as const)("%s after sign-out", (name) => {
  it("refreshes neither run history nor Output previews", async () => {
    const run = deferred<never>();
    jest.mocked(runPipeline).mockReturnValue(run.promise);
    const { rendered, refreshRunHistoryAfterRun, dispatch } = setup();
    let done: Promise<unknown> = Promise.resolve();
    act(() => {
      done = rendered.result.current[name]();
    });
    act(() => {
      store.dispatch(clearAuth());
    });
    (dispatch as unknown as jest.Mock).mockClear();
    await act(async () => {
      run.resolve({ status: "succeeded" } as never);
      await done;
      await flushPromises();
    });
    expect(refreshRunHistoryAfterRun).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
