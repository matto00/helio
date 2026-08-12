// Metric domain types — mirrors the backend `MetricResponse`/`CreateMetricRequest`/
// `UpdateMetricRequest` wire shapes (`MetricProtocol.scala`, HEL-493/HEL-446).

export interface MetricFormat {
  unit?: string | null;
  decimals?: number | null;
  prefix?: string | null;
  suffix?: string | null;
}

/** Mirrors `MetricAggregation.values` (`domain/model.scala`) — kept as a flat
 *  string union (not a full ADT) to match the backend's own deliberately-raw
 *  `String` field, validated only at the repository boundary. */
export const METRIC_AGGREGATIONS = ["sum", "avg", "min", "max", "count", "countDistinct"] as const;
export type MetricAggregation = (typeof METRIC_AGGREGATIONS)[number];

/** Mirrors `MetricResponse` (`MetricProtocol.scala`). */
export interface Metric {
  id: string;
  ownerId: string;
  dataTypeId: string;
  name: string;
  description: string | null;
  measureField: string;
  aggregation: string;
  allowedDimensions: string[];
  format: MetricFormat;
  deprecated: boolean;
  createdAt: string;
  updatedAt: string;
}

/** `GET /api/metrics` and `GET /api/metrics/:id` return the identical wire
 *  shape (no separate summary/detail split on the backend) — this alias
 *  exists for naming parity with `pipelinesSlice`'s `items: PipelineSummary[]`
 *  convention (design.md D2). */
export type MetricSummary = Metric;

/** Mirrors `CreateMetricRequest` (`MetricProtocol.scala`). `description`/
 *  `format` follow the standard absent-omits-key convention (spray-json never
 *  serializes `Option = None`, and the reverse holds for what the backend
 *  accepts) — `undefined` here is dropped by `JSON.stringify` at the request
 *  boundary, so omitting a key is how a caller leaves it unset. */
export interface CreateMetricRequest {
  dataTypeId: string;
  name: string;
  description?: string | null;
  measureField: string;
  aggregation: string;
  allowedDimensions: string[];
  format?: MetricFormat | null;
}

/** Mirrors `UpdateMetricRequest` (`MetricProtocol.scala`)'s absent-vs-null
 *  PATCH convention: every field is optional — an omitted key leaves the
 *  stored value unchanged (the custom backend decoder distinguishes "absent"
 *  from "present"), so callers MUST only set the keys that actually changed.
 *  `dataTypeId` is intentionally absent — it isn't independently patchable
 *  (not in the ticket's field list; re-binding a metric to a different
 *  DataType is out of scope). */
export interface UpdateMetricRequest {
  name?: string;
  description?: string | null;
  measureField?: string;
  aggregation?: string;
  allowedDimensions?: string[];
  format?: MetricFormat | null;
  deprecated?: boolean;
}

/** One panel bound to a metric, within a `MetricUsage` (HEL-560). Mirrors
 *  `MetricUsagePanelResponse` (`MetricProtocol.scala`). */
export interface MetricUsagePanel {
  panelId: string;
  panelTitle: string;
  dashboardId: string;
  dashboardName: string;
}

/** Response shape of `GET /api/metrics/:id/usage` (HEL-560) — the panels
 *  (and their owning dashboards) currently bound to a metric, owner-scoped.
 *  Mirrors `MetricUsageResponse` (`MetricProtocol.scala`). */
export interface MetricUsage {
  metricId: string;
  count: number;
  panels: MetricUsagePanel[];
}
