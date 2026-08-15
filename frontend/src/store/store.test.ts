import { configureStore } from "@reduxjs/toolkit";

import { pushToast, toastsReducer } from "../features/toasts/state/toastsSlice";

/** HEL-413 evaluation-1.md CR1 regression guard. `Toast.action.onClick` (first populated by
 *  `PatchSetReviewPage`'s "Applied. Undo" toast) is an intentional, deliberate non-serializable
 *  value stored in `toasts` state — `store.ts`'s `serializableCheck.ignoredPaths`/
 *  `ignoredActionPaths` configuration must suppress RTK's `serializableStateInvariantMiddleware`
 *  `console.error` for it. Live-reproduced defect this guards against: a single Accept click
 *  produced 12 `console.error` entries (one for the dispatching action, one more for EVERY
 *  subsequent action while the toast persisted — `duration: 0` means it never auto-dismisses).
 *
 *  Builds an isolated store carrying the EXACT SAME `serializableCheck` config `store.ts` uses,
 *  rather than importing the real singleton `store` directly — doing so trips an unrelated,
 *  pre-existing circular-type reference between `store.ts` and `listenerMiddleware.ts`
 *  (`AppStartListening = typeof listenerMiddleware.startListening<RootState, AppDispatch>`) that
 *  only surfaces when `store.ts` itself is ts-jest's per-file compilation entry point; every
 *  existing test that touches `store.ts` today only ever does `import type { RootState }`, which
 *  doesn't force that resolution. Fixing that latent issue is out of scope for this ticket. */
function makeToastsStore(withSerializableCheckFix: boolean) {
  return configureStore({
    reducer: { toasts: toastsReducer },
    middleware: (getDefaultMiddleware) =>
      withSerializableCheckFix
        ? getDefaultMiddleware({
            serializableCheck: {
              ignoredPaths: ["toasts"],
              ignoredActionPaths: ["payload.action.onClick"],
            },
          })
        : getDefaultMiddleware(),
  });
}

describe("store serializableCheck config (mirrors store.ts)", () => {
  it("dispatching a toast with a live onClick closure produces no console.error, including on later actions", () => {
    const store = makeToastsStore(true);
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      store.dispatch(
        pushToast({
          variant: "success",
          message: "Applied.",
          duration: 0,
          action: { label: "Undo", onClick: () => {} },
        }),
      );
      // A second, unrelated action dispatched WHILE the toast is still present in state -- the
      // exact repeated-error pattern live-reproduced in evaluation-1.md (every action dispatched
      // after the toast is pushed re-triggers the state-serializability scan).
      store.dispatch(pushToast({ variant: "info", message: "Unrelated." }));

      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  // Proves the test above is actually meaningful (would catch a regression), not a false-negative-
  // prone no-op: WITHOUT the config fix, the identical dispatch genuinely does log console.error.
  it("WITHOUT the serializableCheck config, the same dispatch DOES log console.error", () => {
    const store = makeToastsStore(false);
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      store.dispatch(
        pushToast({
          variant: "success",
          message: "Applied.",
          action: { label: "Undo", onClick: () => {} },
        }),
      );

      expect(consoleError).toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});
