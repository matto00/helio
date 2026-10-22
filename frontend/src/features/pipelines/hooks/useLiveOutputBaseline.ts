import { useEffect, useRef } from "react";

import { outputHistoryKey, refreshHistory } from "../../panels/history/outputHistoryCache";
import { fetchOutputHistory, type OutputHistory } from "../../panels/history/outputHistoryService";
import { configCompare } from "../../panels/history/metricHistoryView";
import { useOutputHistory } from "../../panels/history/useOutputHistory";

/**
 * HEL-1632 (design.md D4): the displayed Output's last-run baseline for the "vs last run" tile. One
 * `GET /api/outputs/:id/history` per Output per page load through the shared history cache (the same entry and default
 * limit a dashboard panel uses, so a short read cannot poison a sparkline), and one refresh after a real run settles.
 * Nothing here reads it on an edit, a step selection, Discard or any draft change. A failed read is silent (`null`).
 */
export function useLiveOutputBaseline(
  outputId: string | null,
  config: Record<string, unknown> | null,
  run: { status: string | null; isDry: boolean },
): OutputHistory | null {
  // No `pipelineId`: the run-settled refresh below is driven by the page's own run state, so this view opens no
  // run-events subscription of its own.
  const history = useOutputHistory(
    outputId ?? "",
    "",
    undefined,
    undefined,
    outputId !== null,
    config === null ? null : configCompare(config),
  );

  const settled = run.status === "succeeded" || run.status === "failed";
  const previous = useRef(run.status);
  useEffect(() => {
    const was = previous.current;
    previous.current = run.status;
    if (!settled || was === run.status || run.isDry || outputId === null) return;
    refreshHistory(outputHistoryKey(outputId), () => fetchOutputHistory(outputId));
  }, [settled, run.status, run.isDry, outputId]);

  return history;
}
