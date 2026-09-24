// HEL-1096 design.md D7 — the React-wired half of the shared "Run to update" action: reports
// `runToUpdate`'s outcome as its own toast, and (when clicked from a toast's own action) dismisses
// that toast the moment the run is submitted so the affordance never lingers, clickable, after
// it's already been used.

import { useCallback } from "react";

import { useAppDispatch } from "../../../hooks/reduxHooks";
import { useToast } from "../../toasts/hooks/useToast";
import { dismissToast } from "../../toasts/state/toastsSlice";
import { runToUpdate } from "../services/runToUpdate";

/** Returns a click handler bound to `pipelineId`. `dismissToastId`, when given, is dismissed
 *  synchronously (not awaited) — used by the denial toast's own action; the pipeline detail
 *  page's denial block (a persistent block, not a toast) omits it. */
export function useRunToUpdate() {
  const dispatch = useAppDispatch();
  const { push } = useToast();

  return useCallback(
    (pipelineId: string, dismissToastId?: string) => {
      if (dismissToastId !== undefined) dispatch(dismissToast(dismissToastId));
      void runToUpdate(pipelineId).then((result) => {
        push({ variant: result.ok ? "success" : "error", message: result.message });
      });
    },
    [dispatch, push],
  );
}
