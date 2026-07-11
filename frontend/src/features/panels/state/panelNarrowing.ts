// Type-narrowing helpers for the `Panel` discriminated union.
//
// Consumers that need a subtype-specific config field should narrow first
// (`if (isMetricPanel(panel)) { panel.config.dataTypeId … }`) or use one of
// the accessors below for read-only convenience without explicit branches.
//
// `dataTypeId` / `fieldMapping` / `content` / `imageUrl` / `imageFit` /
// `dividerOrientation` / `dividerWeight` / `dividerColor` used to live as
// flat nullable fields on `Panel`; the CS2c-3c wire collapse moves them
// inside the typed `config` payload. The helpers below collapse the now-
// repeated narrowing back to a one-liner at read sites that don't otherwise
// need to know the subtype.

import type {
  ChartAggregation,
  ChartPanel,
  DividerOrientation,
  DividerPanel,
  ImageFit,
  ImagePanel,
  MarkdownPanel,
  MetricAggregation,
  MetricPanel,
  Panel,
  TablePanel,
  TextPanel,
} from "../types/panel";

// ── Narrowing predicates ────────────────────────────────────────────────────

export const isMetricPanel = (p: Panel): p is MetricPanel => p.type === "metric";
export const isChartPanel = (p: Panel): p is ChartPanel => p.type === "chart";
export const isTablePanel = (p: Panel): p is TablePanel => p.type === "table";
export const isTextPanel = (p: Panel): p is TextPanel => p.type === "text";
export const isMarkdownPanel = (p: Panel): p is MarkdownPanel => p.type === "markdown";
export const isImagePanel = (p: Panel): p is ImagePanel => p.type === "image";
export const isDividerPanel = (p: Panel): p is DividerPanel => p.type === "divider";

/** True when the subtype carries a `dataTypeId` / `fieldMapping` binding pair. */
export const isBoundCapablePanel = (p: Panel): p is MetricPanel | ChartPanel | TablePanel =>
  p.type === "metric" || p.type === "chart" || p.type === "table";

// ── Read-only accessors ─────────────────────────────────────────────────────
//
// Backend emits `dataTypeId: ""` for unbound bound-capable panels (the
// empty-string convention preserves typed-config invariants). Frontend
// consumers want a `string | null` view, so we collapse `""` to `null` at
// the accessor boundary — this keeps existing call-site logic
// (`if (panel.typeId) …`) working unchanged through narrowing.

/** Returns the bound DataType id, or `null` if the panel is unbound. */
export function getDataTypeId(panel: Panel): string | null {
  if (!isBoundCapablePanel(panel)) return null;
  const id = panel.config.dataTypeId;
  return id.length > 0 ? id : null;
}

/** Returns the field mapping, or `null` if absent / not applicable. */
export function getFieldMapping(panel: Panel): Record<string, string> | null {
  if (!isBoundCapablePanel(panel)) return null;
  const mapping = panel.config.fieldMapping;
  return Object.keys(mapping).length > 0 ? mapping : null;
}

/** Returns text/markdown content, or `null` for other subtypes. */
export function getContent(panel: Panel): string | null {
  if (isTextPanel(panel) || isMarkdownPanel(panel)) {
    return panel.config.content;
  }
  return null;
}

/** Returns image URL for image panels, otherwise `null`. */
export function getImageUrl(panel: Panel): string | null {
  return isImagePanel(panel) ? panel.config.imageUrl : null;
}

/** Returns image fit for image panels, otherwise `null`. */
export function getImageFit(panel: Panel): ImageFit | null {
  if (!isImagePanel(panel)) return null;
  const fit = panel.config.imageFit;
  if (fit === "contain" || fit === "cover" || fit === "fill") return fit;
  return null;
}

/** Returns divider orientation for divider panels, otherwise `null`. */
export function getDividerOrientation(panel: Panel): DividerOrientation | null {
  if (!isDividerPanel(panel)) return null;
  const o = panel.config.orientation;
  if (o === "horizontal" || o === "vertical") return o;
  return null;
}

/** Returns divider weight (px) for divider panels, otherwise `null`. */
export function getDividerWeight(panel: Panel): number | null {
  if (!isDividerPanel(panel)) return null;
  return panel.config.weight ?? null;
}

/** Returns divider color for divider panels, otherwise `null`. */
export function getDividerColor(panel: Panel): string | null {
  if (!isDividerPanel(panel)) return null;
  return panel.config.color ?? null;
}

/** Returns the metric panel's viz-level aggregation spec (HEL-292), or
 *  `null` when absent / not a metric panel. */
export function getMetricAggregation(panel: Panel): MetricAggregation | null {
  if (!isMetricPanel(panel)) return null;
  return panel.config.aggregation ?? null;
}

/** Returns the chart panel's viz-level groupBy aggregation spec (HEL-292), or
 *  `null` when absent / not a chart panel. */
export function getChartAggregation(panel: Panel): ChartAggregation | null {
  if (!isChartPanel(panel)) return null;
  return panel.config.aggregation ?? null;
}
