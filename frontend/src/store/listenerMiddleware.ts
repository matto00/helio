import { createListenerMiddleware, addListener } from "@reduxjs/toolkit";

import type { RootState, AppDispatch } from "./store";

export const listenerMiddleware = createListenerMiddleware();

// RTK v2's `startListening` is no longer itself a generic function you apply type arguments to
// (`typeof x.startListening<A, B>`, the pre-v2 pattern) — it's a concrete intersection of call
// signatures already bound to `createListenerMiddleware()`'s default (`unknown`) state/dispatch
// types. `.withTypes<State, Dispatch>()` is RTK's own documented replacement (see the doc comment
// on `TypedStartListening` in `@reduxjs/toolkit`'s types) for getting a properly typed listener.
export const startAppListening = listenerMiddleware.startListening.withTypes<
  RootState,
  AppDispatch
>();

export type AppStartListening = typeof startAppListening;

export const addAppListener = addListener.withTypes<RootState, AppDispatch>();
