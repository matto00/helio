import { useEffect, useMemo, useRef, useState } from "react";

import {
  fetchPublicOutputMeta,
  fetchPublicPanelRows,
} from "../../dashboards/services/publicDashboardService";
import type { OutputRowsFilter, OutputRowsSort } from "../../pipelines/services/outputService";
import type { PublicOutputMeta } from "../../pipelines/types/output";
import { getOutputId } from "../state/panelNarrowing";
import type { Panel } from "../types/panel";

export interface PublicPanelDataResult {
  rawRows: string[][] | null;
  headers: string[] | null;
  paginationRows: Record<string, unknown>[] | null;
  isLoading: boolean;
  error: string | null;
  noData: boolean;
  output: PublicOutputMeta | null;
  outputMetaLoading: boolean;
  /** The server's row count for the CURRENT sort/filter (D5/D7's own `totalRowCount` contract) —
   *  threaded to `PanelContent`'s `totalRowCount` prop so the loaded-scope disclosure describes
   *  the whole (filtered) Output, not just this single fetched page. */
  total: number;
}

/** HEL-1190 design.md D1 (task 3.1) — the public/anonymous equivalent of `usePanelData` +
 *  `useOutputMeta` combined into ONE hook (mirrors `usePanelData`'s returned shape so
 *  `PanelContent`'s existing props line up unchanged), fetching `.../panels/:panelId/rows?token=`
 *  and `.../output-meta?token=` instead of the authenticated, session-cookie-based
 *  `fetchPanelPage`/`getOutputById`. No "Load more" affordance on this path (v1 scoping — the
 *  public viewer renders one page, up to `PAGE_SIZE` rows, under the current combined filter;
 *  pagination parity with the authenticated grid is not part of this ticket's scope).
 *
 *  Reuses the SAME request-sequencing discipline `usePanelData`/`panelsSlice`'s
 *  `latestFetchRequestId` establishes (spec.md's "a rapid control change cannot leave a stale
 *  response applied" requirement) via a monotonic local counter — there is no Redux store backing
 *  this hook, so a module-external requestId isn't available; a ref-scoped one serves the same
 *  purpose for this one hook instance. */
export function usePublicPanelData(
  panel: Panel,
  dashboardId: string,
  token: string,
  sort?: OutputRowsSort,
  filter?: OutputRowsFilter,
): PublicPanelDataResult {
  const outputId = getOutputId(panel);
  const panelId = panel.id;

  const [output, setOutput] = useState<PublicOutputMeta | null>(null);
  const [outputMetaLoading, setOutputMetaLoading] = useState(outputId !== null);
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(outputId !== null);
  const [error, setError] = useState<string | null>(null);

  const requestSeqRef = useRef(0);

  const sortKey = sort ? `${sort.column}:${sort.direction}` : "";
  const filterKey = filter ? JSON.stringify(filter) : "";

  useEffect(() => {
    if (!outputId) {
      setOutput(null);
      setOutputMetaLoading(false);
      return;
    }
    let cancelled = false;
    setOutputMetaLoading(true);
    void fetchPublicOutputMeta(dashboardId, panelId, token)
      .then((meta) => {
        if (!cancelled) {
          setOutput(meta);
          setOutputMetaLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOutput(null);
          setOutputMetaLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [outputId, dashboardId, panelId, token]);

  useEffect(() => {
    if (!outputId) {
      setRows(null);
      setIsLoading(false);
      return;
    }
    const mySeq = ++requestSeqRef.current;
    setIsLoading(true);
    void fetchPublicPanelRows(dashboardId, panelId, token, 0, 200, sort, filter)
      .then((result) => {
        // A late-arriving, now-superseded response (this hook's OWN sequencing guard, mirroring
        // `panelsSlice.ts`'s `latestFetchRequestId`) must never overwrite a newer request's result.
        if (requestSeqRef.current !== mySeq) return;
        setRows(result.items);
        setTotal(result.total);
        setError(null);
        setIsLoading(false);
      })
      .catch(() => {
        if (requestSeqRef.current !== mySeq) return;
        setError("Failed to load data.");
        setIsLoading(false);
      });
    // `sort`/`filter` are intentionally represented by their derived string keys below —
    // `sortKey`/`filterKey` are the real dependencies; `sort`/`filter` themselves are read fresh
    // from the closure on every re-run those keys trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outputId, dashboardId, panelId, token, sortKey, filterKey]);

  const headers = useMemo(
    () => (rows && rows.length > 0 ? Object.keys(rows[0]).map(String) : null),
    [rows],
  );
  const rawRows = useMemo(
    () =>
      rows && rows.length > 0
        ? rows.map((row) =>
            Object.values(row).map((v) => (v !== null && v !== undefined ? String(v) : "")),
          )
        : null,
    [rows],
  );

  const noData = rows !== null && rows.length === 0 && !error;

  return {
    rawRows,
    headers,
    paginationRows: rows,
    isLoading,
    error,
    noData,
    output,
    outputMetaLoading,
    total,
  };
}
