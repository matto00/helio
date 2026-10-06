import { httpClient } from "../../../services/httpClient";

/** HEL-1275 — client shapes of L3's `GET /api/outputs/:id/history` and the public
 *  `GET /api/dashboards/:dashboardId/panels/:panelId/history?token=`, folded into ONE shape: the
 *  public variant structurally has no `outputId`/`runId`/`triggerSource`, so those are optional. */
export interface HistoryResolvedPoint {
  capturedAt: string;
  rowCount: number;
  /** `null` for a non-metric Output (and for a non-finite metric). */
  value: number | null;
  /** HEL-1277 — the point's stored chart series; `null` when its summary has none. */
  series?: HistorySeries | null;
  /** The field/aggregation the stored summary's metric used (HEL-1326); `null` for no metric,
   *  absent from an older server. */
  metric?: { field: string; agg: string | null } | null;
}

/** HEL-1277 — a stored reduced chart series (`schemas/outputs/*` `seriesSummary`). */
export interface HistorySeries {
  mode: "grouped" | "rows";
  x: string;
  y: string;
  agg: string | null;
  points: [unknown, number | null][];
  totalPoints: number;
  downsampled: boolean;
}

export interface HistoryColumnStats {
  count: number;
  sum: number | null;
  min: number | null;
  max: number | null;
}

export interface HistorySparklinePoint {
  capturedAt: string;
  value: number | null;
}

export interface HistoryPointMetric {
  field: string;
  agg: string | null;
  value: number | null;
}

export interface HistoryPoint {
  capturedAt: string;
  rowCount: number;
  summary: {
    metric?: HistoryPointMetric | null;
    series?: HistorySeries | null;
    columns?: Record<string, HistoryColumnStats>;
  } & Record<string, unknown>;
  /** Absent on the public variant. */
  id?: string;
  /** Absent on the public variant. */
  hasPayload?: boolean;
  runId?: string | null;
  triggerSource?: string;
}

export interface OutputHistory {
  outputId?: string;
  compare: string | null;
  current: HistoryResolvedPoint | null;
  baseline: HistoryResolvedPoint | null;
  delta: number | null;
  pct: number | null;
  availableFrom: string | null;
  /** Oldest first. */
  sparkline: HistorySparklinePoint[];
  /** Newest first. */
  points: HistoryPoint[];
}

export async function fetchOutputHistory(
  outputId: string,
  options: { limit?: number } = {},
): Promise<OutputHistory> {
  const response = await httpClient.get<OutputHistory>(`/api/outputs/${outputId}/history`, {
    params: options.limit === undefined ? undefined : { limit: options.limit },
  });
  return response.data;
}

/** HEL-1277 — `GET /api/outputs/:id/history/:pointId/rows`: a point's stored row payload
 *  (authenticated only; there is no public counterpart). */
export async function fetchHistoryPointRows(
  outputId: string,
  pointId: string,
): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
  const response = await httpClient.get<{ rows: Record<string, unknown>[]; rowCount: number }>(
    `/api/outputs/${outputId}/history/${pointId}/rows`,
  );
  return response.data;
}

export async function fetchPublicOutputHistory(
  dashboardId: string,
  panelId: string,
  token: string,
): Promise<OutputHistory> {
  const response = await httpClient.get<OutputHistory>(
    `/api/dashboards/${dashboardId}/panels/${panelId}/history`,
    { params: { token } },
  );
  return response.data;
}
