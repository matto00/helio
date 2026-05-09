import { useCallback, useRef, useState } from "react";

import { fetchPanelPage } from "../features/panels/panelsSlice";
import type { MappedPanelData, Panel } from "../types/models";
import { useAppDispatch, useAppSelector } from "./reduxHooks";
import { useEffect } from "react";

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

  const fieldMappingKey = panel.fieldMapping ? JSON.stringify(panel.fieldMapping) : null;
  const currentFetchKey = panel.typeId
    ? panel.id + "|" + panel.typeId + "|" + (fieldMappingKey ?? "")
    : null;

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

    if (prevFetchKey.current === currentFetchKey) {
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
  }, [currentFetchKey, panel.id, panel.type, dispatch, refreshToken]);

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
  const rows = paginationEntry?.rows ?? [];
  const isLoading = paginationEntry?.isLoadingMore === true && rows.length === 0;
  const noData =
    paginationEntry != null && !paginationEntry.isLoadingMore && rows.length === 0 && !error;

  let data: MappedPanelData | null = null;
  let rawRows: string[][] | null = null;
  let headers: string[] | null = null;

  if (rows.length > 0) {
    headers = Object.keys(rows[0]).map(String);
    rawRows = rows.map((row) =>
      Object.values(row).map((v) => (v !== null && v !== undefined ? String(v) : "")),
    );
    const fieldMapping = panel.fieldMapping ?? {};
    const firstRow = rows[0];
    const mapped: MappedPanelData = {};
    for (const [slot, field] of Object.entries(fieldMapping)) {
      const value = firstRow[field];
      mapped[slot] = value !== undefined && value !== null ? String(value) : "";
    }
    data = mapped;
  }

  return { data, rawRows, headers, isLoading, error, noData, refresh };
}
