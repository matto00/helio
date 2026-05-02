import { createContext, useContext } from "react";

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
