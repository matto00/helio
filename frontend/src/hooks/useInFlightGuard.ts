import { useCallback, useRef, useState } from "react";

/** Re-entry guard for an async action keyed by an entity id (HEL-706).
 *
 *  A `useState`-only guard is not re-entry-proof: `setState` inside an event
 *  handler is batched, so two synchronous activations in the same
 *  event-loop tick (a genuine double-click) both read the same pre-update
 *  state snapshot and both pass a "not pending" check before either commits
 *  its update. `ref.current` is mutated synchronously, inline, before either
 *  activation's `fn` is invoked -- the second activation's `guardedRun` call
 *  sees the first's mutation immediately, with no render in between.
 *
 *  `isPending`'s backing `useState` copy exists only to trigger a re-render
 *  so callers can disable their affordance -- the ref is the sole source of
 *  truth the guard check itself reads. */
export function useInFlightGuard<K>() {
  const pendingRef = useRef<Set<K>>(new Set());
  const [pendingState, setPendingState] = useState<ReadonlySet<K>>(new Set());

  const isPending = useCallback((key: K): boolean => pendingState.has(key), [pendingState]);

  // Exposed alongside `isPending` for callers that need to hand the whole
  // pending set down as a boolean-computing prop rather than a function prop
  // (e.g. `StepCard`'s `React.memo` -- see `usePipelineDetailPage.ts`'s
  // `duplicatingStepIds`).
  const pendingKeys: ReadonlySet<K> = pendingState;

  const guardedRun = useCallback((key: K, fn: () => Promise<unknown>): void => {
    if (pendingRef.current.has(key)) return;
    pendingRef.current.add(key);
    setPendingState(new Set(pendingRef.current));
    fn()
      // Defensive only -- this exists so `.finally` below is reachable and no
      // unhandled-rejection warning is raised. It does not replace a call
      // site's own error handling: every call site's `fn` is responsible for
      // handling its own rejection before it ever reaches here.
      .catch(() => {})
      .finally(() => {
        pendingRef.current.delete(key);
        setPendingState(new Set(pendingRef.current));
      });
  }, []);

  return { isPending, guardedRun, pendingKeys };
}
