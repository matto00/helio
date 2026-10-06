import { useId } from "react";

import type { MappedPanelData } from "../../types/panel";
import type { MetricFormat } from "../../../pipelines/ui/outputEditor/outputConfigTypes";
import { FILTERED_NOTE, type MetricComparison } from "../../history/metricHistoryView";
import { MetricSparkline } from "./MetricSparkline";

interface MetricRendererProps {
  data?: MappedPanelData | null;
  /** Numeric display style (HEL-876) — `undefined`/`"number"` is the
   *  pre-HEL-876 default (2 max fraction digits, no grouping). */
  format?: MetricFormat | null;
  /** HEL-1275 — structured comparison from stored history (delta / available-from / filtered
   *  marker). The legacy `data.trend` string path below is unchanged and wins when both are set. */
  comparison?: MetricComparison | null;
  /** HEL-1275 — values oldest to newest; rendered only with at least two. */
  sparkline?: number[] | null;
}

/** Cap the metric value slot's rendered decimal precision at 2 fraction digits (no thousands
 *  grouping) so a long/repeating decimal from an `avg` aggregate doesn't overflow the value slot
 *  (HEL-297; see design.md Decision 1). Empty string, non-numeric text, and non-finite results
 *  (e.g. the literal `"Infinity"`) pass through unchanged — only genuinely numeric-looking
 *  strings are reformatted. `format` (HEL-876) selects the `Intl.NumberFormat` shape applied to
 *  a genuinely numeric value; `"number"`/absent keeps the original HEL-297 formatter exactly. */
export function formatMetricValue(
  value: string | undefined,
  format?: MetricFormat | null,
): string | undefined {
  if (value === undefined || value.trim() === "") return value;
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  switch (format) {
    case "integer":
      return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n);
    case "currency":
      return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(n);
    case "percent":
      return new Intl.NumberFormat(undefined, {
        style: "percent",
        maximumFractionDigits: 2,
      }).format(n);
    case "number":
    default:
      return new Intl.NumberFormat(undefined, {
        maximumFractionDigits: 2,
        useGrouping: false,
      }).format(n);
  }
}

const GLYPHS = { up: "\u25B2", down: "\u25BC", flat: "\u25AC" } as const;

function ComparisonLine({
  comparison,
  format,
}: {
  comparison: MetricComparison;
  format?: MetricFormat | null;
}) {
  const noteId = useId();
  if (comparison.kind === "filtered") {
    return (
      <span
        className="panel-content__metric-note"
        tabIndex={0}
        title={FILTERED_NOTE}
        aria-describedby={noteId}
      >
        Comparison hidden
        <span id={noteId} className="sr-only">
          {FILTERED_NOTE}
        </span>
      </span>
    );
  }
  if (comparison.kind === "availableFrom") {
    return (
      <span className="panel-content__metric-note">
        {comparison.label} comparison available from{" "}
        {new Date(comparison.availableFrom).toLocaleDateString()}
      </span>
    );
  }
  const magnitude =
    comparison.pct !== null
      ? `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(comparison.pct)}%`
      : (formatMetricValue(String(comparison.absDelta), format) ?? String(comparison.absDelta));
  const spokenDirection = comparison.direction === "flat" ? "unchanged" : comparison.direction;
  return (
    <span
      className={`panel-content__metric-trend panel-content__metric-trend--${comparison.direction}`}
      role="img"
      aria-label={`${spokenDirection} ${magnitude} ${comparison.words}`}
    >
      {GLYPHS[comparison.direction]} {magnitude} vs {comparison.label}
    </span>
  );
}

export function MetricRenderer({ data, format, comparison, sparkline }: MetricRendererProps) {
  const trend = data?.trend;
  const trendDirectionClass = trend
    ? trend.startsWith("+")
      ? "panel-content__metric-trend--up"
      : trend.startsWith("-")
        ? "panel-content__metric-trend--down"
        : "panel-content__metric-trend--flat"
    : null;

  // `value`, `label`, and `unit` are all column references resolved via usePanelData
  // (`firstRow[field]`), not literal text — a metric with, say, `label` mapped to a column
  // that isn't present on the fetched rows resolves to an empty string here, same as an
  // unmapped slot. The literal-text override path (typed directly in panel config, rather
  // than resolved from a bound column) is out of scope for this ticket; see the sibling
  // config-depth ticket under HEL-291.
  const hasValue = !!data?.value;

  return (
    <div className="panel-content panel-content--metric">
      <span className="panel-content__metric-value">
        {formatMetricValue(data?.value, format) || "--"}
        {data?.unit && <span className="panel-content__metric-unit">{data.unit}</span>}
      </span>
      {/* The "No data" fallback is keyed on value presence, not label presence — a missing
          label alone should not present as a data-availability problem. */}
      {hasValue ? (
        data?.label && <span className="panel-content__metric-label">{data.label}</span>
      ) : (
        <span className="panel-content__metric-label">No data</span>
      )}
      {trend && (
        <span className={`panel-content__metric-trend ${trendDirectionClass}`}>{trend}</span>
      )}
      {((!trend && comparison) || (sparkline && sparkline.length >= 2)) && (
        // Column when spacious; one inline row in the compact container (default 3x2 card).
        <div className="panel-content__metric-meta">
          {!trend && comparison && <ComparisonLine comparison={comparison} format={format} />}
          {sparkline && sparkline.length >= 2 && <MetricSparkline values={sparkline} />}
        </div>
      )}
    </div>
  );
}
