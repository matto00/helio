import { useCallback, useEffect, useRef, useState } from "react";

import { subscribeToPipelineTerminal } from "../services/pipelineRunFanout";
import { fetchOutputInsight, fetchPublicPanelInsight, type InsightData } from "./insightService";

export type InsightSource =
  | { variant: "authenticated"; outputId: string; pipelineId: string | null }
  | { variant: "public"; dashboardId: string; panelId: string; token: string };

export interface InsightRead {
  data: InsightData | null;
  loading: boolean;
  /** A failed read with nothing to show; a refetch failure keeps the data already held. */
  error: boolean;
  refetch: () => void;
}

/** HEL-1744 D4 -- the stored insight of one panel: fetched on mount, re-fetched when the panel's refresh action runs
 *  (`refetch`) and, for the authenticated variant, when a run of the insight's pipeline finishes. It only ever READS: no
 *  call here asks the server to render. */
export function useInsight(source: InsightSource): InsightRead {
  const [data, setData] = useState<InsightData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [nonce, setNonce] = useState(0);
  const latest = useRef(0);

  const isPublic = source.variant === "public";
  const outputId = source.variant === "authenticated" ? source.outputId : "";
  const pipelineId = source.variant === "authenticated" ? source.pipelineId : null;
  const dashboardId = source.variant === "public" ? source.dashboardId : "";
  const panelId = source.variant === "public" ? source.panelId : "";
  const token = source.variant === "public" ? source.token : "";

  useEffect(() => {
    const request = ++latest.current;
    const read = isPublic
      ? fetchPublicPanelInsight(dashboardId, panelId, token)
      : fetchOutputInsight(outputId);
    read.then(
      (result) => {
        if (request !== latest.current) return;
        setData(result);
        setError(false);
        setLoading(false);
      },
      () => {
        if (request !== latest.current) return;
        setError(true);
        setLoading(false);
      },
    );
  }, [isPublic, dashboardId, panelId, token, outputId, nonce]);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (isPublic || pipelineId === null) return;
    return subscribeToPipelineTerminal(pipelineId, refetch);
  }, [isPublic, pipelineId, refetch]);

  return { data, loading, error: error && data === null, refetch };
}
