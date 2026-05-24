import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchPanelPage } from "../state/panelsSlice";
import { getDataTypeId, getFieldMapping } from "../state/panelNarrowing";
import type { MappedPanelData, Panel } from "../types/panel";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";

export interface PanelDataResult {
  data: MappedPanelData | null;
  rawRows: string[][] | null;
  headers: string[] | null;
  isLoading: boolean;
  error: string | null;
  noData: boolean;
  /** Reset the fetch-deduplication key and trigger a fresh data fetch. */
  refresh: () => void;
}

export function usePanelData(panel: Panel): PanelDataResult {
  const dispatch = useAppDispatch();
  const paginationEntry = useAppSelector((state) => state.panels.paginationState[panel.id]);

  // CS2c-3c — read binding through narrowing helpers so the cache key composes
  // from the bound-trio subtypes' typed config rather than a flat `panel.typeId`.
  // HEL-242 root-cause hypothesis points here; preserve current behavior (cache
  // key shape unchanged: `panelId|typeId|fieldMappingKey`).
  const typeId = getDataTypeId(panel);
  const mapping = getFieldMapping(panel);
  const fieldMappingKey = mapping ? JSON.stringify(mapping) : null;
  const currentFetchKey = typeId ? panel.id + "|" + typeId + "|" + (fieldMappingKey ?? "") : null;

  const prevFetchKey = useRef<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [errorForKey, setErrorForKey] = useState<{ key: string; message: string } | null>(null);

  /**
   * Reset the fetch-deduplication key and trigger a re-render so the data
   * useEffect bypasses its guard and re-fetches on the next tick.
   */
  const refresh = useCallback(() => {
    prevFetchKey.current = null;
    setRefreshToken((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!currentFetchKey) {
      return;
    }

    // HEL-242 — bypass the dedupe early-return when `paginationEntry == null`.
    // A null entry means either the panel has never been fetched OR a stale-
    // invalidation action (e.g. `markDataTypeRowsStale` dispatched after a
    // pipeline-run success) just cleared it; both cases require a fresh fetch.
    if (prevFetchKey.current === currentFetchKey && paginationEntry != null) {
      return;
    }
    prevFetchKey.current = currentFetchKey;

    const pageSize = panel.type === "chart" ? 200 : panel.type === "table" ? 50 : 10;
    const keyAtDispatch = currentFetchKey;

    void dispatch(fetchPanelPage({ panelId: panel.id, page: 0, pageSize }))
      .unwrap()
      .catch(() => {
        setErrorForKey({ key: keyAtDispatch, message: "Failed to load data." });
      });
  }, [currentFetchKey, panel.id, panel.type, dispatch, refreshToken, paginationEntry]);

  // Derive rows unconditionally so the useMemo hooks below (1.1–1.3) are always called.
  // Wrapped in useMemo so the ?? [] fallback doesn't produce a new empty-array
  // reference on every render (which would defeat the downstream memos).
  // paginationEntry is from useAppSelector: Immer returns the same reference
  // when nothing changed, so this memo hits reliably during drag.
  const rows = useMemo(() => paginationEntry?.rows ?? [], [paginationEntry]);

  // 1.1 — Memoize headers keyed on the rows array reference.  Redux only returns a new
  // array when rows actually change, so this memo hits reliably across re-renders.
  const headers = useMemo(
    () => (rows.length > 0 ? Object.keys(rows[0]).map(String) : null),
    [rows],
  );

  // 1.2 — Memoize rawRows keyed on the rows array reference.
  const rawRows = useMemo(
    () =>
      rows.length > 0
        ? rows.map((row) =>
            Object.values(row).map((v) => (v !== null && v !== undefined ? String(v) : "")),
          )
        : null,
    [rows],
  );

  // 1.3 — Memoize data (field-mapped first-row object) keyed on rows + fieldMappingKey.
  // fieldMappingKey is a stable JSON string; parsing it inside the memo avoids a
  // dependency on the mapping object reference (which may be recreated each render).
  const data = useMemo<MappedPanelData | null>(() => {
    if (rows.length === 0 || !fieldMappingKey) return null;
    const fieldMapping = JSON.parse(fieldMappingKey) as Record<string, string>;
    const firstRow = rows[0];
    const mapped: MappedPanelData = {};
    for (const [slot, field] of Object.entries(fieldMapping)) {
      const value = firstRow[field];
      mapped[slot] = value !== undefined && value !== null ? String(value) : "";
    }
    return mapped;
  }, [rows, fieldMappingKey]);

  if (!currentFetchKey) {
    return {
      data: null,
      rawRows: null,
      headers: null,
      isLoading: false,
      error: null,
      noData: false,
      refresh,
    };
  }

  const error = errorForKey?.key === currentFetchKey ? errorForKey.message : null;
  const isLoading = paginationEntry?.isLoadingMore === true && rows.length === 0;
  const noData =
    paginationEntry != null && !paginationEntry.isLoadingMore && rows.length === 0 && !error;

  return { data, rawRows, headers, isLoading, error, noData, refresh };
}
