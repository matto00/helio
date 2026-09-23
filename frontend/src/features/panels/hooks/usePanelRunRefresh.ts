import { useEffect, useRef } from "react";

import { subscribeToPipelineSucceeded } from "../services/pipelineRunFanout";
import { useOutputMeta } from "./useOutputMeta";

/**
 * Fans a panel's bound Output into the shared per-pipeline SSE subscription
 * (`pipelineRunFanout.ts`, design.md D4): resolves `pipelineId` via `useOutputMeta(outputId)`,
 * then calls `refresh` every time that pipeline's run-status stream reports `succeeded`.
 *
 * No-ops for a non-output panel (`outputId` is `null`) or while the Output's `pipelineId` hasn't
 * resolved yet. Subscribes/unsubscribes on `pipelineId` change and on unmount.
 */
export function usePanelRunRefresh(outputId: string | null, refresh: () => void): void {
  const { output } = useOutputMeta(outputId);
  const pipelineId = output?.pipelineId ?? null;

  // Stable ref so the SSE listener always calls the latest `refresh` without needing to
  // resubscribe (and thus reopen the shared connection) when its identity changes.
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    if (!pipelineId) return;
    return subscribeToPipelineSucceeded(pipelineId, () => refreshRef.current());
  }, [pipelineId]);
}
