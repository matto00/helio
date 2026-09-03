import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchPanelPage } from "../state/panelsSlice";
import { getOutputId } from "../state/panelNarrowing";
import type { MappedPanelData, Panel } from "../types/panel";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import type { RequestErrorKind } from "../../../services/classifyRequestError";

export interface PanelDataResult {
  data: MappedPanelData | null;
  rawRows: string[][] | null;
  headers: string[] | null;
  isLoading: boolean;
  error: string | null;
  /** Classification of `error` — `null` when there is no error. */
  errorKind: RequestErrorKind | null;
  noData: boolean;
  /** HEL-946 Bug C(2): true when `noData` is caused by the bound Output's
   *  node never having been materialized by a successful pipeline run, as
   *  opposed to a node that ran and legitimately returned zero rows.
   *  Always `false` while `noData` is `false`. */
  neverMaterialized: boolean;
  /** Retained for renderer-compatibility during the HEL-909 migration; the
   *  Output itself now owns any groupBy aggregation, so this is always
   *  `null`. */
  chartAggregate: null;
  /** Reset the fetch-deduplication key and trigger a fresh data fetch. */
  refresh: () => void;
}

/** Fetches rows for an output-kind panel's bound Output
 *  (`GET /api/outputs/:id/rows`). Non-output panels never fetch. */
export function usePanelData(panel: Panel): PanelDataResult {
  const dispatch = useAppDispatch();
  const paginationEntry = useAppSelector((state) => state.panels.paginationState[panel.id]);

  const outputId = getOutputId(panel);
  const currentFetchKey = outputId ? panel.id + "|" + outputId : null;

  const prevFetchKey = useRef<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [errorForKey, setErrorForKey] = useState<{
    key: string;
    message: string;
    kind: RequestErrorKind;
  } | null>(null);

  const refresh = useCallback(() => {
    prevFetchKey.current = null;
    setErrorForKey(null);
    setRefreshToken((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!currentFetchKey || !outputId) {
      return;
    }

    if (prevFetchKey.current === currentFetchKey && paginationEntry != null) {
      return;
    }
    prevFetchKey.current = currentFetchKey;

    const keyAtDispatch = currentFetchKey;

    void dispatch(fetchPanelPage({ panelId: panel.id, outputId, page: 0, pageSize: 200 }))
      .unwrap()
      .then(() => {
        setErrorForKey((prev) => (prev?.key === keyAtDispatch ? null : prev));
      })
      .catch((err: { message?: string; kind?: RequestErrorKind } | undefined) => {
        setErrorForKey({
          key: keyAtDispatch,
          message: err?.message ?? "Failed to load data.",
          kind: err?.kind ?? "error",
        });
      });
  }, [currentFetchKey, outputId, panel.id, dispatch, refreshToken, paginationEntry]);

  const rows = useMemo(() => paginationEntry?.rows ?? [], [paginationEntry]);

  const headers = useMemo(
    () => (rows.length > 0 ? Object.keys(rows[0]).map(String) : null),
    [rows],
  );

  const rawRows = useMemo(
    () =>
      rows.length > 0
        ? rows.map((row) =>
            Object.values(row).map((v) => (v !== null && v !== undefined ? String(v) : "")),
          )
        : null,
    [rows],
  );

  if (!currentFetchKey) {
    return {
      data: null,
      rawRows: null,
      headers: null,
      isLoading: false,
      error: null,
      errorKind: null,
      noData: false,
      neverMaterialized: false,
      chartAggregate: null,
      refresh,
    };
  }

  const error = errorForKey?.key === currentFetchKey ? errorForKey.message : null;
  const errorKind = errorForKey?.key === currentFetchKey ? errorForKey.kind : null;
  const isLoading =
    paginationEntry == null || (paginationEntry.isLoadingMore === true && rows.length === 0);
  const noData =
    paginationEntry != null && !paginationEntry.isLoadingMore && rows.length === 0 && !error;
  // HEL-946 Bug C(2) -- defaults to `true` (materialized) before the fetch
  // resolves, so `neverMaterialized` never fires spuriously while loading;
  // `paginationEntry.materialized` only becomes meaningful once `noData` is
  // also true.
  const neverMaterialized = noData && paginationEntry?.materialized === false;

  return {
    data: null,
    rawRows,
    headers,
    isLoading,
    error,
    errorKind,
    noData,
    neverMaterialized,
    chartAggregate: null,
    refresh,
  };
}
