import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchOutputInsight,
  refreshOutputInsight,
  type InsightAttempt,
  type InsightData,
} from "./insightService";

export const INSIGHT_REFRESH_POLL_MS = 2000;
export const INSIGHT_REFRESH_TIMEOUT_MS = 45000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A newer attempt: the server coalesces a repeated skip into the newest row (its id stays, its time moves), so either differs. */
function attemptChanged(before: InsightAttempt | null, after: InsightAttempt | null): boolean {
  if (after === null) return false;
  return before === null || before.id !== after.id || before.createdAt !== after.createdAt;
}

/** HEL-1743 D13 -- the panel's Refresh button: posts the refresh (the server answers before the model does), then polls the
 *  read every 2 s until the newest attempt changes or 45 s pass, then clears. `started: false` (a render was already in
 *  flight) just polls. Never throws: a failed post clears the pending state, sets `failed` and leaves the panel as it was. */
export function useInsightRefresh(outputId: string, data: InsightData | null, refetch: () => void) {
  const [pending, setPending] = useState(false);
  // A failed start (rate limit, no access, network) is shown inline; cleared when the next attempt begins.
  const [failed, setFailed] = useState(false);
  const mounted = useRef(true);
  const running = useRef(false);
  const latest = useRef(data);
  latest.current = data;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setPending(true);
    setFailed(false);
    const before = latest.current?.lastAttempt ?? null;
    try {
      await refreshOutputInsight(outputId);
      const deadline = Date.now() + INSIGHT_REFRESH_TIMEOUT_MS;
      while (mounted.current && Date.now() < deadline) {
        await sleep(INSIGHT_REFRESH_POLL_MS);
        if (!mounted.current) break;
        const next = await fetchOutputInsight(outputId).catch(() => null);
        if (next && attemptChanged(before, next.lastAttempt)) break;
      }
    } catch {
      // The post failed (rate limit, no access, network): nothing changed server-side. Never swallowed (DESIGN.md section 7).
      if (mounted.current) setFailed(true);
    } finally {
      running.current = false;
      if (mounted.current) {
        setPending(false);
        refetch();
      }
    }
  }, [outputId, refetch]);

  return { pending, failed, refresh };
}
