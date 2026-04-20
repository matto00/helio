import { useCallback, useEffect, useRef, useState } from "react";

import { fetchSources } from "../features/sources/sourcesSlice";
import { fetchCsvPreview, fetchRestPreview } from "../services/dataSourceService";
import type { DataSource, DataType, MappedPanelData, Panel } from "../types/models";
import { useAppDispatch } from "./reduxHooks";

interface SourcesSlice {
  items: DataSource[];
  status: "idle" | "loading" | "succeeded" | "failed";
}

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

export function usePanelData(
  panel: Panel,
  dataTypes: DataType[],
  sources: SourcesSlice,
): PanelDataResult {
  const dispatch = useAppDispatch();
  const [data, setData] = useState<MappedPanelData | null>(null);
  const [rawRows, setRawRows] = useState<string[][] | null>(null);
  const [headers, setHeaders] = useState<string[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noData, setNoData] = useState(false);

  const fieldMappingKey = panel.fieldMapping ? JSON.stringify(panel.fieldMapping) : null;
  const prevFetchKey = useRef<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  /**
   * Reset the fetch-deduplication key and trigger a re-render so the data
   * useEffect bypasses its guard and re-fetches on the next tick.
   */
  const refresh = useCallback(() => {
    prevFetchKey.current = null;
    setRefreshToken((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!panel.typeId) {
      setData(null);
      setRawRows(null);
      setHeaders(null);
      setIsLoading(false);
      setError(null);
      setNoData(false);
      return;
    }

    const dataType = dataTypes.find((dt) => dt.id === panel.typeId);
    if (!dataType || !dataType.sourceId) {
      return;
    }

    if (sources.status === "idle") {
      dispatch(fetchSources());
      return;
    }

    if (sources.status === "loading") {
      setIsLoading(true);
      return;
    }

    const source = sources.items.find((s) => s.id === dataType.sourceId);
    if (!source) {
      return;
    }

    const fetchKey = panel.typeId + "|" + (dataType.sourceId ?? "") + "|" + (fieldMappingKey ?? "");
    if (prevFetchKey.current === fetchKey) {
      return;
    }
    prevFetchKey.current = fetchKey;

    setIsLoading(true);
    setError(null);
    setNoData(false);
    setData(null);
    setRawRows(null);
    setHeaders(null);

    const fieldMapping = panel.fieldMapping ?? {};

    async function fetchData() {
      try {
        if (source!.sourceType === "csv" || source!.sourceType === "static") {
          const preview = await fetchCsvPreview(source!.id);
          if (preview.rows.length === 0) {
            setNoData(true);
          } else {
            const firstRow = preview.rows[0];
            const mapped: MappedPanelData = {};
            for (const [slot, field] of Object.entries(fieldMapping)) {
              const colIndex = preview.headers.indexOf(field);
              if (colIndex !== -1) {
                mapped[slot] = firstRow[colIndex] ?? "";
              }
            }
            setData(mapped);
            setRawRows(preview.rows);
            setHeaders(preview.headers);
          }
        } else {
          const preview = await fetchRestPreview(source!.id);
          if (preview.rows.length === 0) {
            setNoData(true);
          } else {
            const firstRow = preview.rows[0];
            const mapped: MappedPanelData = {};
            for (const [slot, field] of Object.entries(fieldMapping)) {
              const value = firstRow[field];
              mapped[slot] = value !== undefined && value !== null ? String(value) : "";
            }
            setData(mapped);
            const stringRows = preview.rows.map((row) =>
              Object.values(row).map((v) => (v !== null && v !== undefined ? String(v) : "")),
            );
            const hdrs = preview.rows.length > 0 ? Object.keys(preview.rows[0]).map(String) : [];
            setRawRows(stringRows);
            setHeaders(hdrs);
          }
        }
      } catch {
        setError("Failed to load data.");
      } finally {
        setIsLoading(false);
      }
    }

    void fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fieldMappingKey is a stable JSON serialisation of panel.fieldMapping; refreshToken drives manual re-fetches
  }, [panel.typeId, fieldMappingKey, dataTypes, sources, dispatch, refreshToken]);

  return { data, rawRows, headers, isLoading, error, noData, refresh };
}
