// HEL-1305 — echarts-free helpers behind the chart time x axis. Kept free of any echarts import so
// the main bundle can reuse them without pulling the lazy-loaded echarts chunk in (HEL-512).

import type { ChartType } from "./chartTypes";
import { parseInstantParts } from "./timestampParsing";

/** Schema type (`Output.schema[].type`) that selects a time x axis. */
export const TIMESTAMP_FIELD_TYPE = "timestamp";

/** Field name -> declared schema type, as built once per render site from an Output's schema. */
export type ChartFieldTypes = Record<string, string>;

/** `true` when the field plotted on x is declared `timestamp` (owner ruling 1: schema type only, no
 *  value sniffing — a string-typed date column stays a category axis until cast). */
export function isTimeXField(
  fieldTypes: ChartFieldTypes | null | undefined,
  fieldName: string | undefined,
): boolean {
  return fieldName !== undefined && fieldTypes?.[fieldName] === TIMESTAMP_FIELD_TYPE;
}

/** What a builder needs to decide on a time axis (owner ruling 5: not horizontal bar). */
export interface TimeAxisContext {
  fieldTypes?: ChartFieldTypes | null;
  horizontalBar?: boolean;
}

/** `true` when the plotted x field is declared `timestamp` and the chart type has a time axis. */
export function wantsTimeAxis(
  chartType: ChartType,
  ctx: TimeAxisContext | undefined,
  xField: string | undefined,
): boolean {
  if (!ctx || !isTimeXField(ctx.fieldTypes, xField)) return false;
  return (
    chartType === "line" || chartType === "scatter" || (chartType === "bar" && !ctx.horizontalBar)
  );
}

/** Builds `ChartFieldTypes` from any `{name, type}`-shaped list; `null` when there is nothing. */
export function toChartFieldTypes(
  fields: ReadonlyArray<{ name: string; type: string }> | null | undefined,
): ChartFieldTypes | null {
  if (!fields || fields.length === 0) return null;
  return Object.fromEntries(fields.map((f) => [f.name, f.type]));
}

/** Epoch milliseconds (UTC) of the instant `raw` denotes, or `null`, read exactly as the backend's
 *  `TimestampParsing.parseInstant` reads a string (HEL-1640: one shared reader, `parseInstantParts`;
 *  shared-test-fixtures/chart-timestamp-parsing.json pins it to the Scala parser). Sub-millisecond digits
 *  are floored. Never throws. */
export function parseChartInstant(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const parts = parseInstantParts(raw);
  return parts === undefined ? null : Number(parts.seconds) * 1000 + Math.floor(parts.nanos / 1e6);
}

const MS_PER_DAY = 86_400_000;

/** `true` when every instant is exactly midnight UTC (the tooltip then shows the date only). */
export function allMidnightUtc(instants: readonly number[]): boolean {
  return instants.every((t) => ((t % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY === 0);
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** `yyyy-MM-dd` (or `yyyy-MM-dd HH:mm` with `withTime`) of an epoch-millis instant, in UTC. */
export function formatChartInstant(ms: number, withTime: boolean): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return String(ms);
  const date = `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return withTime ? `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : date;
}
