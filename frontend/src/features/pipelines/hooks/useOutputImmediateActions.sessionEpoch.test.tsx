// HEL-1798: creating an Output while the session ends does not preview it afterwards.
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { Provider } from "react-redux";

import { clearAuth } from "../../auth/state/authSlice";
import { store } from "../../../store/store";
import { createOutput, previewOutputs } from "../services/outputService";
import { deferred } from "./sessionEpochTestKit";
import { useOutputImmediateActions } from "./useOutputImmediateActions";

jest.mock("../services/outputService");

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>{children}</Provider>
);

beforeEach(() => {
  jest.resetAllMocks();
  act(() => {
    store.dispatch(clearAuth());
  });
});

describe("useOutputImmediateActions.create after sign-out", () => {
  it("does not request a preview of the created Output", async () => {
    const created = deferred<never>();
    jest.mocked(createOutput).mockReturnValue(created.promise);
    const { result } = renderHook(() => useOutputImmediateActions("pipe-A"), { wrapper });
    let done: Promise<unknown> = Promise.resolve();
    act(() => {
      done = result.current
        .create({ kind: "table", name: "n", config: {} })
        ?.catch(() => {}) as Promise<unknown>;
    });
    act(() => {
      store.dispatch(clearAuth());
    });
    await act(async () => {
      created.resolve({ id: "out-new" } as never);
      await done;
    });
    expect(previewOutputs).not.toHaveBeenCalled();
  });
});
