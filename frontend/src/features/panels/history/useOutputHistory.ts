import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

import { subscribeToPipelineTerminal } from "../services/pipelineRunFanout";
import {
  getCachedHistory,
  invalidateHistory,
  loadHistory,
  outputHistoryKey,
  publicHistoryKey,
  refreshHistory,
  subscribeHistory,
} from "./outputHistoryCache";
import {
  fetchOutputHistory,
  fetchPublicOutputHistory,
  type OutputHistory,
} from "./outputHistoryService";

/** Where a metric panel reads its history: the authenticated per-Output route (default), or the
 *  token-authorized public panel route (HEL-1275 design.md D4). */
export type HistorySource = { variant: "public"; dashboardId: string; token: string };

/** HEL-1275 — the shared history read for one metric panel. `null` while loading or unavailable
 *  (a failed read is silent: the panel keeps its loaded-rows rendering). Fetches nothing unless
 *  `enabled` (metric-kind Outputs only). Only the authenticated key subscribes to pipeline-terminal
 *  events; a public viewer fetches once on mount, like public provenance. */
export function useOutputHistory(
  outputId: string,
  panelId: string,
  pipelineId: string | undefined,
  source: HistorySource | undefined,
  enabled: boolean,
  /** The Output config's current `compare` (null-normalised). A cached history resolved for a
   *  different comparison is refetched, once per distinct expected value (cannot loop). */
  expectedCompare: string | null,
): OutputHistory | null {
  const isPublic = source !== undefined;
  const key = source ? publicHistoryKey(source.dashboardId, panelId) : outputHistoryKey(outputId);
  const publicDashboardId = source?.dashboardId;
  const publicToken = source?.token;
  const fetcher = useCallback(
    (): Promise<OutputHistory> =>
      publicDashboardId !== undefined
        ? fetchPublicOutputHistory(publicDashboardId, panelId, publicToken ?? "")
        : fetchOutputHistory(outputId),
    [publicDashboardId, publicToken, panelId, outputId],
  );

  const history = useSyncExternalStore(subscribeHistory, () => getCachedHistory(key));

  useEffect(() => {
    if (!enabled || getCachedHistory(key)) return;
    loadHistory(key, fetcher).catch(() => undefined);
  }, [enabled, key, fetcher]);

  const refetchedFor = useRef<{ key: string; compare: string | null } | null>(null);
  useEffect(() => {
    if (!enabled || !history || (history.compare ?? null) === expectedCompare) return;
    const done = refetchedFor.current;
    if (done && done.key === key && done.compare === expectedCompare) return;
    refetchedFor.current = { key, compare: expectedCompare };
    invalidateHistory(key);
    loadHistory(key, fetcher).catch(() => undefined);
  }, [enabled, history, expectedCompare, key, fetcher]);

  useEffect(() => {
    if (!enabled || isPublic || !pipelineId) return;
    return subscribeToPipelineTerminal(pipelineId, () => refreshHistory(key, fetcher));
  }, [enabled, isPublic, pipelineId, key, fetcher]);

  return enabled ? (history ?? null) : null;
}
