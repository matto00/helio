// HEL-1798: the boot chain's truncated-banner history fetch does not run after sign-out.
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { Provider } from "react-redux";

import { clearAuth } from "../../auth/state/authSlice";
import { store } from "../../../store/store";
import { fetchRunHistory, getPipelineById } from "../services/pipelineService";
import { fetchPipelineById } from "../state/pipelinesSlice";
import { deferred } from "./sessionEpochTestKit";
import { useRunHistory } from "./useRunHistory";

jest.mock("../services/pipelineService");

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>{children}</Provider>
);

beforeEach(() => {
  jest.resetAllMocks();
  act(() => {
    store.dispatch(clearAuth());
  });
});

describe("useRunHistory.loadRunHistoryWhenTruncated after sign-out", () => {
  it("requests no run history when a truncated pipeline fetch lands after clearAuth", async () => {
    const pipeline = deferred<never>();
    jest.mocked(getPipelineById).mockReturnValue(pipeline.promise);
    const { result } = renderHook(() => useRunHistory("pipe-A"), { wrapper });
    let chained: Promise<unknown> = Promise.resolve();
    act(() => {
      const fetch = store.dispatch(fetchPipelineById("pipe-A"));
      result.current.loadRunHistoryWhenTruncated("pipe-A", fetch);
      chained = fetch;
    });
    act(() => {
      store.dispatch(clearAuth());
    });
    await act(async () => {
      pipeline.resolve({
        id: "pipe-A",
        name: "A",
        lastRunTruncated: true,
        roots: [],
      } as never);
      await chained;
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(fetchRunHistory).not.toHaveBeenCalled();
  });
});
