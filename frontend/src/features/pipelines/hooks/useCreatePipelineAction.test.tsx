import { configureStore } from "@reduxjs/toolkit";
import { act, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { Provider } from "react-redux";

import { pipelinesReducer } from "../state/pipelinesSlice";
import { useCreatePipelineAction } from "./useCreatePipelineAction";

function makeStore() {
  return configureStore({ reducer: { pipelines: pipelinesReducer } });
}

function wrapper(store: ReturnType<typeof makeStore>) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <Provider store={store}>{children}</Provider>;
  };
}

// HEL-548 D4/D5/workspace-create-actions — a pure flag-flip create action:
// it cannot fail and is never in flight, since CreatePipelineModal owns its
// own submission. Its flow is shell-mounted (App.tsx, F-045), so — unlike
// useAddSourceAction/useCreatePanelAction — this is the one action D5b
// records as usable from ANY route; that reach is exercised in the browser
// (task 4.4/8.4), not re-asserted here since this hook itself dispatches
// only a flag, with no knowledge of what route it was called from.
describe("useCreatePipelineAction", () => {
  it("reports no failure and no in-flight state", () => {
    const store = makeStore();
    const { result } = renderHook(() => useCreatePipelineAction(), { wrapper: wrapper(store) });

    expect(result.current.error).toBeNull();
    expect(result.current.isPending).toBe(false);
  });

  it("invoking the descriptor's onClick opens the CreatePipelineModal flow (sets createModalOpen)", () => {
    const store = makeStore();
    const { result } = renderHook(() => useCreatePipelineAction(), { wrapper: wrapper(store) });

    expect(store.getState().pipelines.createModalOpen).toBe(false);
    act(() => result.current.cta.onClick());
    expect(store.getState().pipelines.createModalOpen).toBe(true);
  });

  it("returns a descriptor labelled to name the thing it actually creates (D4)", () => {
    const store = makeStore();
    const { result } = renderHook(() => useCreatePipelineAction(), { wrapper: wrapper(store) });

    expect(result.current.cta.label).toBe("New pipeline");
  });
});
