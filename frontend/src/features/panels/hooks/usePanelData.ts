import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchPanelPage } from "../state/panelsSlice";
import {
  getChartAggregation,
  getDataTypeId,
  getFieldMapping,
  getMetricAggregation,
} from "../state/panelNarrowing";
import type { MappedPanelData, Panel } from "../types/panel";
import {
  computeAggregate,
  groupAndAggregate,
  type GroupedAggregate,
} from "../../../utils/aggregate";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";

export interface PanelDataResult {
  data: MappedPanelData | null;
  rawRows: string[][] | null;
  headers: string[] | null;
  isLoading: boolean;
  error: string | null;
  noData: boolean;
  /** HEL-292: precomputed groupBy aggregate for a chart panel with an
   *  `aggregation` spec — `null` when the panel has none. Computed over the
   *  typed `rows` (real `null`/`undefined` intact), NOT `rawRows`. */
  chartAggregate: GroupedAggregate | null;
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

  // HEL-292 — a viz-level aggregation spec changes how much of the row set
  // usePanelData needs in memory (see pageSize below), so it must be part of
  // the fetch-dedupe key: toggling/editing the spec re-fetches at the right
  // page size instead of silently reusing a smaller cached page.
  const metricAggregation = getMetricAggregation(panel);
  const chartAggregationSpec = getChartAggregation(panel);
  const aggregationKey = metricAggregation
    ? JSON.stringify(metricAggregation)
    : chartAggregationSpec
      ? JSON.stringify(chartAggregationSpec)
      : null;

  const currentFetchKey = typeId
    ? panel.id + "|" + typeId + "|" + (fieldMappingKey ?? "") + "|" + (aggregationKey ?? "")
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

    // HEL-242 — bypass the dedupe early-return when `paginationEntry == null`.
    // A null entry means either the panel has never been fetched OR a stale-
    // invalidation action (e.g. `markDataTypeRowsStale` dispatched after a
    // pipeline-run success) just cleared it; both cases require a fresh fetch.
    if (prevFetchKey.current === currentFetchKey && paginationEntry != null) {
      return;
    }
    prevFetchKey.current = currentFetchKey;

    // HEL-292 — an aggregation spec needs the FULL row set in memory (the
    // aggregate is computed over all bound rows, not a page of them), so
    // request a page size covering the whole set instead of the
    // metric/chart default.
    const pageSize = aggregationKey
      ? Number.MAX_SAFE_INTEGER
      : panel.type === "chart"
        ? 200
        : panel.type === "table"
          ? 50
          : 10;
    const keyAtDispatch = currentFetchKey;

    void dispatch(fetchPanelPage({ panelId: panel.id, page: 0, pageSize }))
      .unwrap()
      .catch(() => {
        setErrorForKey({ key: keyAtDispatch, message: "Failed to load data." });
      });
  }, [
    currentFetchKey,
    panel.id,
    panel.type,
    dispatch,
    refreshToken,
    paginationEntry,
    aggregationKey,
  ]);

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
  // HEL-292 — when a metric aggregation spec is set, the `value` slot is overridden
  // with `computeAggregate` over ALL rows instead of `rows[0]`; label/unit/trend are
  // unaffected and continue to read fieldMapping off the first row.
  // HEL-292 (cycle-3 fix) — design.md Decision 3 makes `metricAggregation`
  // independent of `fieldMapping`: a metric panel may have an aggregation
  // spec with no field-mapping slots set at all (`fieldMapping === {}`,
  // `fieldMappingKey === null`). The guard must not bail out to `null` in
  // that case, or the aggregate override below is never reached.
  const data = useMemo<MappedPanelData | null>(() => {
    if (rows.length === 0 || (!fieldMappingKey && !metricAggregation)) return null;
    const fieldMapping = fieldMappingKey
      ? (JSON.parse(fieldMappingKey) as Record<string, string>)
      : {};
    const firstRow = rows[0];
    const mapped: MappedPanelData = {};
    for (const [slot, field] of Object.entries(fieldMapping)) {
      const value = firstRow[field];
      mapped[slot] = value !== undefined && value !== null ? String(value) : "";
    }
    if (metricAggregation) {
      const aggregate = computeAggregate(rows, metricAggregation.value, metricAggregation.agg);
      mapped.value = aggregate !== null ? String(aggregate) : "";
    }
    return mapped;
  }, [rows, fieldMappingKey, metricAggregation]);

  // HEL-292 — precomputed groupBy aggregate for a chart panel with an
  // `aggregation` spec, computed over the typed `rows` (real `null`/`undefined`
  // intact) so `count` can distinguish null from a genuine empty string.
  const chartAggregate = useMemo<GroupedAggregate | null>(() => {
    if (rows.length === 0 || !chartAggregationSpec) return null;
    return groupAndAggregate(
      rows,
      chartAggregationSpec.groupBy,
      chartAggregationSpec.agg,
      chartAggregationSpec.yField,
    );
  }, [rows, chartAggregationSpec]);

  if (!currentFetchKey) {
    return {
      data: null,
      rawRows: null,
      headers: null,
      isLoading: false,
      error: null,
      noData: false,
      chartAggregate: null,
      refresh,
    };
  }

  const error = errorForKey?.key === currentFetchKey ? errorForKey.message : null;
  const isLoading = paginationEntry?.isLoadingMore === true && rows.length === 0;
  const noData =
    paginationEntry != null && !paginationEntry.isLoadingMore && rows.length === 0 && !error;

  return { data, rawRows, headers, isLoading, error, noData, chartAggregate, refresh };
}
