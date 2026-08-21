import {
  DEFAULT_DURATION,
  MAX_VISIBLE_TOASTS,
  dismissToast,
  pushToast,
  toastsReducer,
} from "./toastsSlice";

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

  // HEL-535 5.5 — D3: `prepare` applies the default duration.
  it("prepare applies the default duration when none is given", () => {
    const state = toastsReducer(undefined, pushToast({ variant: "info", message: "A" }));
    expect(state.items[0].duration).toBe(DEFAULT_DURATION);
  });

  it("prepare preserves an explicit non-zero duration", () => {
    const state = toastsReducer(
      undefined,
      pushToast({ variant: "info", message: "A", duration: 8000 }),
    );
    expect(state.items[0].duration).toBe(8000);
  });

  it("prepare preserves an explicit zero duration (never auto-dismisses)", () => {
    const state = toastsReducer(
      undefined,
      pushToast({ variant: "info", message: "A", duration: 0 }),
    );
    expect(state.items[0].duration).toBe(0);
  });

  // HEL-535 5.1 — D1: cap eviction at and beyond the boundary.
  describe("concurrent-toast cap (D1)", () => {
    it("retains all toasts up to the cap without evicting any", () => {
      let state = toastsReducer(undefined, { type: "@@INIT" });
      for (let i = 0; i < MAX_VISIBLE_TOASTS; i++) {
        state = toastsReducer(state, pushToast({ variant: "info", message: `Toast ${i}` }));
      }
      expect(state.items).toHaveLength(MAX_VISIBLE_TOASTS);
      expect(state.items.map((t) => t.message)).toEqual(["Toast 0", "Toast 1", "Toast 2"]);
    });

    it("evicts the oldest auto-dismissing toast once the cap is exceeded", () => {
      let state = toastsReducer(undefined, { type: "@@INIT" });
      for (let i = 0; i < MAX_VISIBLE_TOASTS + 1; i++) {
        state = toastsReducer(state, pushToast({ variant: "info", message: `Toast ${i}` }));
      }
      expect(state.items).toHaveLength(MAX_VISIBLE_TOASTS);
      // Oldest (Toast 0) evicted; the three newest remain, newest last.
      expect(state.items.map((t) => t.message)).toEqual(["Toast 1", "Toast 2", "Toast 3"]);
    });

    it("evicts multiple times to stay at the cap when pushed well beyond it", () => {
      let state = toastsReducer(undefined, { type: "@@INIT" });
      for (let i = 0; i < MAX_VISIBLE_TOASTS + 3; i++) {
        state = toastsReducer(state, pushToast({ variant: "info", message: `Toast ${i}` }));
      }
      expect(state.items).toHaveLength(MAX_VISIBLE_TOASTS);
      expect(state.items.map((t) => t.message)).toEqual(["Toast 3", "Toast 4", "Toast 5"]);
    });

    // HEL-535 5.2 — HEL-343 Undo regression guard: a sticky toast survives eviction pressure.
    it("never evicts a duration:0 sticky toast under eviction pressure", () => {
      let state = toastsReducer(undefined, { type: "@@INIT" });
      state = toastsReducer(
        state,
        pushToast({
          variant: "success",
          message: "Applied.",
          duration: 0,
          action: { label: "Undo", onClick: () => undefined },
        }),
      );
      for (let i = 0; i < MAX_VISIBLE_TOASTS + 2; i++) {
        state = toastsReducer(state, pushToast({ variant: "info", message: `Toast ${i}` }));
      }
      expect(state.items.some((t) => t.message === "Applied.")).toBe(true);
      expect(state.items).toHaveLength(MAX_VISIBLE_TOASTS);
      // The sticky toast holds a slot, so only MAX_VISIBLE_TOASTS - 1 auto-dismissing toasts fit —
      // the two oldest ("Toast 0", "Toast 1") are evicted, leaving the newest two plus the sticky one.
      expect(state.items.map((t) => t.message)).toEqual(["Applied.", "Toast 3", "Toast 4"]);
    });

    it("also exempts an action-bearing toast with a non-zero duration", () => {
      let state = toastsReducer(undefined, { type: "@@INIT" });
      state = toastsReducer(
        state,
        pushToast({
          variant: "success",
          message: "Applied.",
          action: { label: "Undo", onClick: () => undefined },
        }),
      );
      for (let i = 0; i < MAX_VISIBLE_TOASTS + 1; i++) {
        state = toastsReducer(state, pushToast({ variant: "info", message: `Toast ${i}` }));
      }
      expect(state.items.some((t) => t.message === "Applied.")).toBe(true);
    });

    // HEL-535 5.3 — an all-exempt state still admits a new push.
    it("still admits a new push when every toast in state is exempt", () => {
      let state = toastsReducer(undefined, { type: "@@INIT" });
      for (let i = 0; i < MAX_VISIBLE_TOASTS; i++) {
        state = toastsReducer(
          state,
          pushToast({
            variant: "success",
            message: `Sticky ${i}`,
            duration: 0,
            action: { label: "Undo", onClick: () => undefined },
          }),
        );
      }
      expect(state.items).toHaveLength(MAX_VISIBLE_TOASTS);
      state = toastsReducer(state, pushToast({ variant: "info", message: "Newest" }));
      expect(state.items).toHaveLength(MAX_VISIBLE_TOASTS + 1);
      expect(state.items.some((t) => t.message === "Newest")).toBe(true);
      // All three original sticky toasts are still present — nothing evicted.
      expect(state.items.filter((t) => t.message.startsWith("Sticky"))).toHaveLength(
        MAX_VISIBLE_TOASTS,
      );
    });
  });

  // HEL-535 5.4 — D1: coalescing.
  describe("duplicate coalescing (D1)", () => {
    it("coalesces an identical variant+message into a single entry with a fresh id", () => {
      let state = toastsReducer(undefined, { type: "@@INIT" });
      state = toastsReducer(state, pushToast({ variant: "error", message: "Failed to save." }));
      const firstId = state.items[0].id;
      state = toastsReducer(state, pushToast({ variant: "error", message: "Failed to save." }));
      expect(state.items).toHaveLength(1);
      expect(state.items[0].id).not.toBe(firstId);
    });

    it("moves a coalesced repeat to the newest position", () => {
      let state = toastsReducer(undefined, { type: "@@INIT" });
      state = toastsReducer(state, pushToast({ variant: "error", message: "Repeat." }));
      state = toastsReducer(state, pushToast({ variant: "info", message: "Other." }));
      state = toastsReducer(state, pushToast({ variant: "error", message: "Repeat." }));
      expect(state.items.map((t) => t.message)).toEqual(["Other.", "Repeat."]);
    });

    it("does not coalesce toasts with a different message", () => {
      let state = toastsReducer(undefined, { type: "@@INIT" });
      state = toastsReducer(state, pushToast({ variant: "error", message: "Failed A." }));
      state = toastsReducer(state, pushToast({ variant: "error", message: "Failed B." }));
      expect(state.items).toHaveLength(2);
    });

    it("does not coalesce identical messages with a different variant", () => {
      let state = toastsReducer(undefined, { type: "@@INIT" });
      state = toastsReducer(state, pushToast({ variant: "warning", message: "Same text." }));
      state = toastsReducer(state, pushToast({ variant: "error", message: "Same text." }));
      expect(state.items).toHaveLength(2);
    });
  });
});
