// HEL-1305 — echarts-free helpers behind the chart time x axis. Kept free of any echarts import so
// the main bundle can reuse them without pulling the lazy-loaded echarts chunk in (HEL-512).

import type { ChartType } from "./chartTypes";

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

// Mirrors backend `TimestampParsing.parseInstant`; shared-test-fixtures/chart-timestamp-parsing.json
// pins the two together. Never `Date.parse` a time-zone-less string: JS reads it as LOCAL time.
const EPOCH_MILLIS_THRESHOLD = 9999999999n;
const LONG_MAX = 9223372036854775807n;
const MAX_SCALE_MAGNITUDE = 40;
// Epochs are bounded to years 0001-01-01T00:00:00Z .. 9999-12-31T23:59:59.999Z (HEL-1502 D5); the
// backend's upper bound is the same instant to the nanosecond, which millisecond precision cannot exceed.
const MIN_EPOCH_MS = -62135596800000;
const MAX_EPOCH_MS = 253402300799999;
const MAX_OFFSET_SECONDS = 18 * 3600;
const DECIMAL = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;
const DATE = "(\\d{4})-(\\d{2})-(\\d{2})";
const TIME = "(\\d{2}):(\\d{2})(?::(\\d{2}))?";
const FRACTION = "(?:\\.(\\d{1,9}))?";
// A numeric offset is a sign then HH, HHMM, HH:MM or HH:MM:SS (HEL-1502 D1); `Z` is checked in code
// (T separator only). The optional `[id]` is stripped syntactically and never validated (D2).
const OFFSET = "[+-](?:\\d{4}|\\d{2}(?::\\d{2}(?::\\d{2})?)?)";
const REGION_ID = "(?:\\[[A-Za-z0-9_+\\-/:]+\\])?";
const ISO_ZONED = new RegExp(`^${DATE}([Tt ])${TIME}${FRACTION}(${OFFSET}|[Zz])${REGION_ID}$`);
const ISO_LOCAL = new RegExp(`^${DATE}[T ]${TIME}${FRACTION}$`, "i");
const ISO_DATE = new RegExp(`^${DATE}$`);
const US_DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

/** A whole-number epoch the way the backend reads a numeric string, or `null`. */
function wholeEpoch(s: string): bigint | null {
  const m = DECIMAL.exec(s);
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) return null;
  const digits = BigInt(`${m[2]}${m[3] ?? ""}` || "0");
  const exponent = m[4] === undefined ? 0 : Number(m[4]);
  const scale = (m[3] ?? "").length - exponent;
  if (!Number.isFinite(scale) || Math.abs(scale) > MAX_SCALE_MAGNITUDE) return null;
  let value: bigint;
  if (scale <= 0) {
    value = digits * 10n ** BigInt(-scale);
  } else {
    const divisor = 10n ** BigInt(scale);
    if (digits % divisor !== 0n) return null;
    value = digits / divisor;
  }
  value = m[1] === "-" ? -value : value;
  return value >= -LONG_MAX - 1n && value <= LONG_MAX ? value : null;
}

function utcMillis(
  y: number,
  mo: number,
  d: number,
  h = 0,
  mi = 0,
  s = 0,
  fraction = "",
): number | null {
  if (h > 23 || mi > 59 || s > 59) return null;
  const date = new Date(0);
  date.setUTCFullYear(y, mo - 1, d);
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) {
    return null;
  }
  const ms = Number(fraction.padEnd(3, "0").slice(0, 3));
  return date.setUTCHours(h, mi, s, ms);
}

/** Seconds east of UTC for `Z` or a grammar-valid numeric offset; `null` past 18:00 or for minutes or
 *  seconds above 59 (mirrors `ZoneOffset.ofHoursMinutesSeconds`). */
function offsetSeconds(offset: string): number | null {
  if (offset.toUpperCase() === "Z") return 0;
  const digits = offset.slice(1).replace(/:/g, "");
  const h = Number(digits.slice(0, 2));
  const m = digits.length >= 4 ? Number(digits.slice(2, 4)) : 0;
  const sec = digits.length >= 6 ? Number(digits.slice(4, 6)) : 0;
  if (m > 59 || sec > 59) return null;
  const total = h * 3600 + m * 60 + sec;
  if (total > MAX_OFFSET_SECONDS) return null;
  return offset[0] === "-" ? -total : total;
}

/** Epoch milliseconds (UTC) of the instant `raw` denotes, or `null`. Accepts the backend's set —
 *  whole-number epochs (seconds, milliseconds above 9999999999), ISO instants and offset date-times,
 *  Postgres numeric offsets (`+HH`, `+HHMM`, `+HH:MM`, `+HH:MM:SS`) on a `T` or space separator, a
 *  `[Region/Id]` suffix read at the written offset, time-zone-less date-times read as UTC, bare
 *  `yyyy-MM-dd` and `MM/dd/yyyy` as midnight UTC. Epochs are bounded to years 0001-9999. Never throws. */
export function parseChartInstant(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const s = raw.trim();
  if (s === "") return null;

  const epoch = wholeEpoch(s);
  if (epoch !== null) {
    const millis =
      epoch > EPOCH_MILLIS_THRESHOLD || epoch < -EPOCH_MILLIS_THRESHOLD ? epoch : epoch * 1000n;
    const n = Number(millis);
    return n >= MIN_EPOCH_MS && n <= MAX_EPOCH_MS ? n : null;
  }

  const zoned = ISO_ZONED.exec(s);
  if (zoned) {
    const [, y, mo, d, separator, h, mi, sec, fraction, offset] = zoned;
    if (separator === " " && offset.toUpperCase() === "Z") return null;
    if (fraction !== undefined && sec === undefined) return null; // the backend's fraction needs seconds
    const local = utcMillis(+y, +mo, +d, +h, +mi, sec ? +sec : 0, fraction);
    const shift = offsetSeconds(offset);
    return local === null || shift === null ? null : local - shift * 1000;
  }
  const local = ISO_LOCAL.exec(s);
  if (local) {
    const [, y, mo, d, h, mi, sec, fraction] = local;
    return utcMillis(+y, +mo, +d, +h, +mi, sec ? +sec : 0, fraction);
  }
  const date = ISO_DATE.exec(s);
  if (date) return utcMillis(+date[1], +date[2], +date[3]);
  const us = US_DATE.exec(s);
  if (us) return utcMillis(+us[3], +us[1], +us[2]);
  return null;
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
