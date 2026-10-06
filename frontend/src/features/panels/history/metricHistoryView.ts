import type { HistoryPoint, OutputHistory } from "./outputHistoryService";

/** The metric field/aggregation the server's `OutputSummaryReducer.metric` would resolve for a
 *  config (HEL-1275 design.md D2). `agg` is `null` when the config has no aggregation. */
export interface ServerMetricField {
  field: string;
  agg: string | null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function nested(config: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const v = config[key];
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** Port of `OutputSummaryReducer.metric`'s selection rule: exactly one string field-mapping value
 *  wins; otherwise `fieldMapping.value`, then `aggregation.value`. */
export function resolveServerMetricField(
  config: Record<string, unknown>,
): ServerMetricField | null {
  const mapping = nested(config, "fieldMapping");
  const aggregation = nested(config, "aggregation");
  const strings = Object.values(mapping ?? {}).filter((v): v is string => typeof v === "string");
  const field =
    strings.length === 1
      ? strings[0]
      : (nonEmptyString(mapping?.value) ?? nonEmptyString(aggregation?.value));
  if (field === null) return null;
  return { field, agg: nonEmptyString(aggregation?.agg) };
}

function pointMatches(point: HistoryPoint | undefined, resolved: ServerMetricField): boolean {
  const metric = point?.summary?.metric;
  return !!metric && metric.field === resolved.field && (metric.agg ?? null) === resolved.agg;
}

export type MetricComparison =
  | {
      kind: "delta";
      direction: "up" | "down" | "flat";
      /** Absolute percent when the server gave one. */
      pct: number | null;
      /** Absolute delta, used when `pct` is null. */
      absDelta: number;
      label: string;
      /** Spoken form of the window, e.g. "7 days earlier". */
      words: string;
      baselineAt: string;
      baselineValue: number;
    }
  | { kind: "availableFrom"; label: string; availableFrom: string }
  | { kind: "filtered" };

export interface MetricHistoryView {
  /** Server all-rows headline, or `null` to keep the loaded-rows value. */
  headline: number | null;
  /** Values oldest to newest; `null` unless at least two usable points. */
  sparkline: number[] | null;
  comparison: MetricComparison | null;
}

export const FILTERED_NOTE = "comparison reflects unfiltered data";

/** `config.compare` normalised: a non-string (absent or `null`) is `null`. */
export function configCompare(config: Record<string, unknown>): string | null {
  return typeof config.compare === "string" ? config.compare : null;
}

const EMPTY_VIEW: MetricHistoryView = { headline: null, sparkline: null, comparison: null };

/** Short window label. `previous_run` reads "previous" (never "previous run": after thinning the
 *  prior point is the previous *surviving* point — HEL-1285). */
export function compareLabel(compare: string): string {
  if (compare === "previous_run") return "previous";
  if (compare === "1d" || compare === "7d" || compare === "30d") return compare;
  const m = /^custom:P(\d+)D$/.exec(compare);
  if (m) return `${Number(m[1])}d`;
  const h = /^custom:PT(\d+)H$/.exec(compare);
  if (h) return `${Number(h[1])}h`;
  return "custom";
}

function compareWords(compare: string): string {
  const label = compareLabel(compare);
  if (label === "previous") return "versus the previous point";
  if (label === "custom") return "versus an earlier point";
  const n = Number.parseInt(label, 10);
  const unit = label.endsWith("h") ? "hour" : "day";
  return `versus ${n} ${unit}${n === 1 ? "" : "s"} earlier`;
}

/** HEL-1275 design.md D2/D3 — everything a metric panel needs from its history response, with the
 *  metric-identity guard (a point only counts when its stored field/agg equals what the CURRENT
 *  config resolves to) and the filtered-state rule (headline stays the loaded rows; delta, note and
 *  sparkline collapse to one marker, and only when a comparison would otherwise show). */
export function selectMetricHistoryView(
  history: OutputHistory | null,
  config: Record<string, unknown>,
  filterActive: boolean,
): MetricHistoryView {
  if (!history || !history.current || history.current.value === null) return EMPTY_VIEW;
  const resolved = resolveServerMetricField(config);
  if (!resolved || !pointMatches(history.points[0], resolved)) return EMPTY_VIEW;

  // A comparison saved after this history was cached (e.g. in the Output editor) leaves it
  // describing the OLD window: keep the headline but show no delta, note or sparkline until the
  // refetch lands. Absent and `null` both mean "no comparison".
  if ((history.compare ?? null) !== configCompare(config)) {
    return {
      headline: filterActive ? null : history.current.value,
      sparkline: null,
      comparison: null,
    };
  }

  const matching = new Set(
    history.points.filter((p) => pointMatches(p, resolved)).map((p) => p.capturedAt),
  );
  const values = history.sparkline
    .filter((s) => matching.has(s.capturedAt) && s.value !== null)
    .map((s) => s.value as number);
  const sparkline = values.length >= 2 ? values : null;

  let comparison: MetricComparison | null = null;
  const { compare, baseline, delta, pct, availableFrom } = history;
  if (compare !== null) {
    const baselineInPoints = baseline
      ? history.points.find((p) => p.capturedAt === baseline.capturedAt)
      : undefined;
    const baselineStale =
      baselineInPoints !== undefined && !pointMatches(baselineInPoints, resolved);
    if (baseline && delta !== null && baseline.value !== null) {
      if (!baselineStale) {
        comparison = {
          kind: "delta",
          direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
          pct: pct === null ? null : Math.abs(pct),
          absDelta: Math.abs(delta),
          label: compareLabel(compare),
          words: compareWords(compare),
          baselineAt: baseline.capturedAt,
          baselineValue: baseline.value,
        };
      }
    } else if (!baseline && availableFrom !== null) {
      comparison = { kind: "availableFrom", label: compareLabel(compare), availableFrom };
    }
  }

  if (filterActive) {
    return {
      headline: null,
      sparkline: null,
      comparison: comparison || sparkline ? { kind: "filtered" } : null,
    };
  }
  return { headline: history.current.value, sparkline, comparison };
}
