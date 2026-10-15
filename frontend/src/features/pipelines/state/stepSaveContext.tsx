// StepSaveContext — HEL-1579 (design.md D7/D8): the page-level seam between the focused step
// editor's persistence (`useStepCardPersist`) and the desktop layout. Three jobs:
//   1. a pending-saves tracker: every step PATCH registers its promise, so the preview GET for a
//      newly selected step can wait until the saved upstream config is what the server has;
//   2. `isStepPresent`: the unmount flush is skipped for a step that no longer exists (Remove);
//   3. `reportSaveError`: a flushed PATCH that fails after its editor unmounted has nowhere local
//      to show the message, so it goes to a page-level map the spine row and the re-selected
//      editor read.
// Absent on the phone (no provider), where `useStepCardPersist` keeps its original behaviour.

import { createContext, useContext, useMemo, useRef } from "react";

export interface StepSaveTracker {
  /** Registers an in-flight step write; the tracker never rejects on its behalf. */
  register: (pending: Promise<unknown>) => void;
  /** Resolves once no registered write is pending, including writes registered while waiting. */
  whenIdle: () => Promise<void>;
}

export interface StepSaveContextValue {
  tracker: StepSaveTracker;
  isStepPresent: (stepId: string) => boolean;
  reportSaveError: (stepId: string, message: string | null) => void;
}

export const StepSaveContext = createContext<StepSaveContextValue | null>(null);

export function useStepSaveContext(): StepSaveContextValue | null {
  return useContext(StepSaveContext);
}

/** A stable tracker (one instance per mount). */
export function usePendingStepSaves(): StepSaveTracker {
  const pending = useRef(new Set<Promise<unknown>>());
  return useMemo<StepSaveTracker>(
    () => ({
      register(promise) {
        const settled = promise.then(
          () => undefined,
          () => undefined,
        );
        pending.current.add(settled);
        void settled.then(() => {
          pending.current.delete(settled);
        });
      },
      async whenIdle() {
        while (pending.current.size > 0) {
          await Promise.all([...pending.current]);
        }
      },
    }),
    [],
  );
}
