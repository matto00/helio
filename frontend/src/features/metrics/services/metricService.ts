import type { PagedResult } from "../../../types/models";
import { httpClient } from "../../../services/httpClient";
import type {
  CreateMetricRequest,
  Metric,
  MetricSummary,
  UpdateMetricRequest,
} from "../types/metric";

/** Wire shape of a Metric: the backend serializes `description: Option[String]`
 *  with spray-json, which omits the field entirely when it is `None` — a
 *  metric created without a description arrives without the key at all
 *  (documented codebase gotcha; see `dataTypeService.ts`'s `normalizeDataType`
 *  for the same class of fix). */
type MetricWire = Omit<Metric, "description"> & { description?: string | null };

/** Normalize an absent `description` to `null` so the store always satisfies
 *  the declared `description: string | null` contract against real API
 *  responses (design.md D2). */
function normalizeMetric(wire: MetricWire): Metric {
  return { ...wire, description: wire.description ?? null };
}

export async function fetchMetrics(): Promise<MetricSummary[]> {
  const response = await httpClient.get<PagedResult<MetricWire>>("/api/metrics");
  return response.data.items.map(normalizeMetric);
}

export async function fetchMetricById(id: string): Promise<Metric> {
  const response = await httpClient.get<MetricWire>(`/api/metrics/${id}`);
  return normalizeMetric(response.data);
}

export async function createMetric(request: CreateMetricRequest): Promise<Metric> {
  const response = await httpClient.post<MetricWire>("/api/metrics", request);
  return normalizeMetric(response.data);
}

/** PATCH `/api/metrics/:id`. `request` must carry only the fields the caller
 *  intends to change — every field follows the backend's absent-vs-null
 *  convention (`UpdateMetricRequest`'s custom decoder): an omitted key leaves
 *  the stored value unchanged. */
export async function updateMetric(id: string, request: UpdateMetricRequest): Promise<Metric> {
  const response = await httpClient.patch<MetricWire>(`/api/metrics/${id}`, request);
  return normalizeMetric(response.data);
}

export async function deleteMetric(id: string): Promise<void> {
  await httpClient.delete(`/api/metrics/${id}`);
}
