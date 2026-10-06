import { httpClient } from "../../../services/httpClient";

/** HEL-1275 — client shapes of L3's `GET /api/outputs/:id/history` and the public
 *  `GET /api/dashboards/:dashboardId/panels/:panelId/history?token=`, folded into ONE shape: the
 *  public variant structurally has no `outputId`/`runId`/`triggerSource`, so those are optional. */
export interface HistoryResolvedPoint {
  capturedAt: string;
  rowCount: number;
  /** `null` for a non-metric Output (and for a non-finite metric). */
  value: number | null;
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
  summary: { metric?: HistoryPointMetric | null } & Record<string, unknown>;
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

export async function fetchOutputHistory(outputId: string): Promise<OutputHistory> {
  const response = await httpClient.get<OutputHistory>(`/api/outputs/${outputId}/history`);
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
