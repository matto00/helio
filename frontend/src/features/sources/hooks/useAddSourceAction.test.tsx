import { configureStore } from "@reduxjs/toolkit";
import { act, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { Provider } from "react-redux";

import { sourcesReducer } from "../state/sourcesSlice";
import { useAddSourceAction } from "./useAddSourceAction";

function makeStore() {
  return configureStore({ reducer: { sources: sourcesReducer } });
}

function wrapper(store: ReturnType<typeof makeStore>) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <Provider store={store}>{children}</Provider>;
  };
}

// HEL-548 D5/workspace-create-actions — a pure flag-flip create action: it
// cannot fail and is never in flight, since AddSourceModal owns its own
// submission.
describe("useAddSourceAction", () => {
  it("reports no failure and no in-flight state", () => {
    const store = makeStore();
    const { result } = renderHook(() => useAddSourceAction(), { wrapper: wrapper(store) });

    expect(result.current.error).toBeNull();
    expect(result.current.isPending).toBe(false);
  });

  it("invoking the descriptor's onClick opens the AddSourceModal flow (sets addModalOpen)", () => {
    const store = makeStore();
    const { result } = renderHook(() => useAddSourceAction(), { wrapper: wrapper(store) });

    expect(store.getState().sources.addModalOpen).toBe(false);
    act(() => result.current.cta.onClick());
    expect(store.getState().sources.addModalOpen).toBe(true);
  });

  it("returns a descriptor directly assignable to EmptyState's cta prop", () => {
    const store = makeStore();
    const { result } = renderHook(() => useAddSourceAction(), { wrapper: wrapper(store) });

    expect(result.current.cta.label).toBe("Add source");
    expect(typeof result.current.cta.onClick).toBe("function");
  });
});
