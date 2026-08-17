import { createContext, useCallback, useContext, useMemo, useRef } from "react";

export interface SaveStateContextValue {
  /** Register an imperative flush callback from PanelGrid. Pass null to deregister. */
  registerFlush: (fn: (() => void) | null) => void;
  /** Trigger an immediate flush of pending panel updates. */
  flush: () => void;
}

export const SaveStateContext = createContext<SaveStateContextValue>({
  registerFlush: () => undefined,
  flush: () => undefined,
});

export function useSaveState(): SaveStateContextValue {
  return useContext(SaveStateContext);
}

/**
 * Builds the `flushFnRef`/`registerFlush`/`flush` glue that backs
 * `SaveStateContext.Provider`'s value — colocated with the context itself so
 * `AppShell` doesn't have to own this bookkeeping inline. Call once per
 * provider instance and pass the result straight to the `Provider`.
 */
export function useSaveStateRegistry(): SaveStateContextValue {
  const flushFnRef = useRef<(() => void) | null>(null);

  const registerFlush = useCallback((fn: (() => void) | null) => {
    flushFnRef.current = fn;
  }, []);

  const flush = useCallback(() => {
    flushFnRef.current?.();
  }, []);

  return useMemo(() => ({ registerFlush, flush }), [registerFlush, flush]);
}
