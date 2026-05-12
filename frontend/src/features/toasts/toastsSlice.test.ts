import { dismissToast, pushToast, toastsReducer } from "./toastsSlice";

describe("toastsSlice", () => {
  it("starts with no toasts", () => {
    const state = toastsReducer(undefined, { type: "@@INIT" });
    expect(state.items).toHaveLength(0);
  });

  it("pushToast adds a toast with a generated id", () => {
    const state = toastsReducer(
      undefined,
      pushToast({ variant: "success", message: "Dashboard created." }),
    );
    expect(state.items).toHaveLength(1);
    expect(state.items[0].variant).toBe("success");
    expect(state.items[0].message).toBe("Dashboard created.");
    expect(typeof state.items[0].id).toBe("string");
  });

  it("pushToast preserves optional duration and action", () => {
    const action = { label: "Retry", onClick: () => undefined };
    const state = toastsReducer(
      undefined,
      pushToast({ variant: "error", message: "Failed.", duration: 8000, action }),
    );
    expect(state.items[0].duration).toBe(8000);
    expect(state.items[0].action).toBe(action);
  });

  it("dismissToast removes only the matching id", () => {
    let state = toastsReducer(undefined, { type: "@@INIT" });
    state = toastsReducer(state, pushToast({ variant: "info", message: "First." }));
    state = toastsReducer(state, pushToast({ variant: "warning", message: "Second." }));
    expect(state.items).toHaveLength(2);
    const firstId = state.items[0].id;
    state = toastsReducer(state, dismissToast(firstId));
    expect(state.items).toHaveLength(1);
    expect(state.items[0].message).toBe("Second.");
  });

  it("dismissToast is a no-op for unknown id", () => {
    let state = toastsReducer(undefined, { type: "@@INIT" });
    state = toastsReducer(state, pushToast({ variant: "info", message: "Stays." }));
    state = toastsReducer(state, dismissToast("nonexistent"));
    expect(state.items).toHaveLength(1);
  });

  it("can stack multiple toasts", () => {
    let state = toastsReducer(undefined, { type: "@@INIT" });
    state = toastsReducer(state, pushToast({ variant: "success", message: "A" }));
    state = toastsReducer(state, pushToast({ variant: "error", message: "B" }));
    state = toastsReducer(state, pushToast({ variant: "warning", message: "C" }));
    expect(state.items).toHaveLength(3);
  });
});
