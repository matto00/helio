// HEL-1581 — UTC instants for `cast` date/timestamp, `datebucket` and the compute date/time
// functions. A numeric string is read by `epochOfString`, a port of `TimestampParsing.epochOf`'s String arm
// (Java `Long.parseLong` / `BigDecimal`, which accept any Unicode decimal digit; `parseChartInstant` is
// ASCII-only there, a pre-existing chart gap that is out of scope). Every other timestamp string goes to
// `parseChartInstant`, which `chart-timestamp-parsing.json` holds to `TimestampParsing.parseInstant` for
// ASCII input. This module also adds the nanosecond fraction that
// `parseChartInstant` truncates to milliseconds, and Java's `Instant.toString` / `ISO_INSTANT`
// rendering (omit a zero fraction, otherwise groups of 3, 6 or 9 digits; years outside 0000-9999
// carry a sign).

import { parseChartInstant } from "../../../utils/chartTimeAxis";
import { digitValue, javaTrim } from "./javaNumbers";

/** An instant as epoch seconds (floor) plus a 0..999,999,999 nanosecond-of-second. */
export interface InstantParts {
  seconds: bigint;
  nanos: number;
}

const EPOCH_MILLIS_THRESHOLD = 9999999999;
const MIN_EPOCH_MS = -62135596800000;
const MAX_EPOCH_MS = 253402300799999;
const FRACTION_AFTER_SECONDS = /^[+-]?\d+-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}\.(\d{1,9})/;

function fromMillis(ms: number): InstantParts {
  const seconds = Math.floor(ms / 1000);
  return { seconds: BigInt(seconds), nanos: (ms - seconds * 1000) * 1_000_000 };
}

const DECIMAL = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;
const LONG_MIN = -(2n ** 63n);
const LONG_MAX = 2n ** 63n - 1n;

/** Replaces each Unicode decimal digit (BMP, as `Character.digit`) with its ASCII digit. */
function asciiDigits(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const d = s.charCodeAt(i) < 128 ? -1 : digitValue(s, i);
    out += d >= 0 ? String(d) : s[i];
  }
  return out;
}

/** `Try(BigDecimal(s)).filter(|scale| <= 40 && isWhole).toLongExact` for a trimmed string, or `undefined`. */
function wholeLongOfDecimal(s: string): bigint | undefined {
  const m = DECIMAL.exec(asciiDigits(s));
  if (!m) return undefined;
  const fraction = m[3] ?? "";
  if (m[2] === "" && fraction === "") return undefined;
  const exponent = m[4] === undefined ? 0 : Number(m[4]);
  const scale = fraction.length - exponent;
  if (!Number.isFinite(scale) || Math.abs(scale) > 40) return undefined;
  const unscaled = BigInt(`${m[2]}${fraction}` || "0");
  let value: bigint;
  if (scale <= 0) value = unscaled * 10n ** BigInt(-scale);
  else {
    const divisor = 10n ** BigInt(scale);
    if (unscaled % divisor !== 0n) return undefined;
    value = unscaled / divisor;
  }
  if (m[1] === "-") value = -value;
  return value >= LONG_MIN && value <= LONG_MAX ? value : undefined;
}

/** `TimestampParsing.epochOf` for a String: `Long.parseLong(trim)`, else a whole `BigDecimal`; bounded to 0001-9999. */
function epochOfString(trimmed: string): InstantParts | undefined | null {
  // `Long.parseLong` accepts a subset of what the whole-`BigDecimal` arm accepts, with the same value.
  const epoch = wholeLongOfDecimal(trimmed);
  if (epoch === undefined) return null;
  const millisUnit = epoch > 9999999999n || epoch < -9999999999n;
  const seconds = millisUnit ? floorDiv(epoch, 1000n) : epoch;
  const nanos = millisUnit ? Number(epoch - seconds * 1000n) * 1_000_000 : 0;
  if (seconds < -62135596800n || seconds > 253402300799n) return undefined;
  return { seconds, nanos };
}

/** The instant a numeric string or a timestamp string denotes (`TimestampParsing.parseInstant` on a String). */
export function parseInstantString(raw: string): InstantParts | undefined {
  // Java `trim` strips code units <= U+0020 only; a string still padded with other whitespace (U+00A0) is
  // not a timestamp on the JVM, but `parseChartInstant` would trim it again.
  const trimmed = javaTrim(raw);
  if (trimmed !== trimmed.trim()) return undefined;
  raw = trimmed;
  const epoch = epochOfString(raw);
  if (epoch !== null) return epoch;
  const ms = parseChartInstant(raw);
  if (ms === null) return undefined;
  const parts = fromMillis(ms);
  const fraction = FRACTION_AFTER_SECONDS.exec(raw.trim());
  if (fraction) parts.nanos = Number(fraction[1].padEnd(9, "0"));
  return parts;
}

/** `TimestampParsing.epochInstant` for a numeric cell: a whole number, seconds or (above 9999999999)
 *  milliseconds, within years 0001-9999. */
export function epochInstantOfNumber(n: number): InstantParts | undefined {
  if (!Number.isFinite(n) || !Number.isInteger(n) || Math.abs(n) >= 2 ** 63) return undefined;
  const millis = Math.abs(n) > EPOCH_MILLIS_THRESHOLD ? n : n * 1000;
  if (millis < MIN_EPOCH_MS || millis > MAX_EPOCH_MS) return undefined;
  return fromMillis(millis);
}

// --- civil calendar (proleptic Gregorian, UTC) -------------------------------------------------------

const floorDiv = (a: bigint, b: bigint): bigint => {
  const q = a / b;
  return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q;
};

export interface CivilDate {
  year: bigint;
  month: number;
  day: number;
}

/** Days since 1970-01-01 to a civil date (Howard Hinnant's algorithm). */
export function civilFromEpochDay(epochDay: bigint): CivilDate {
  const z = epochDay + 719468n;
  const era = floorDiv(z, 146097n);
  const doe = z - era * 146097n;
  const yoe = (doe - doe / 1460n + doe / 36524n - doe / 146096n) / 365n;
  const doy = doe - (365n * yoe + yoe / 4n - yoe / 100n);
  const mp = (5n * doy + 2n) / 153n;
  const day = Number(doy - (153n * mp + 2n) / 5n + 1n);
  const month = Number(mp < 10n ? mp + 3n : mp - 9n);
  const year = yoe + era * 400n + (month <= 2 ? 1n : 0n);
  return { year, month, day };
}

export function epochDayFromCivil(year: bigint, month: number, day: number): bigint {
  const y = month <= 2 ? year - 1n : year;
  const era = floorDiv(y, 400n);
  const yoe = y - era * 400n;
  const m = BigInt(month);
  const doy = (153n * (m > 2n ? m - 3n : m + 9n) + 2n) / 5n + BigInt(day) - 1n;
  const doe = yoe * 365n + yoe / 4n - yoe / 100n + doy;
  return era * 146097n + doe - 719468n;
}

export const epochDayOf = (seconds: bigint): bigint => floorDiv(seconds, 86400n);

/** Monday-based day of week (Monday = 0) of an epoch day. */
export const mondayIndex = (epochDay: bigint): number => Number((((epochDay + 3n) % 7n) + 7n) % 7n);

const pad = (n: number | bigint, width: number): string => String(n).padStart(width, "0");

/** `LocalDate.toString` for years 0001-9999. */
export function formatDate(epochDay: bigint): string {
  const { year, month, day } = civilFromEpochDay(epochDay);
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** `DateTimeFormatter.ISO_INSTANT` / `Instant.toString`. */
export function formatInstant({ seconds, nanos }: InstantParts): string {
  const epochDay = epochDayOf(seconds);
  const secondOfDay = Number(seconds - epochDay * 86400n);
  const { year, month, day } = civilFromEpochDay(epochDay);
  let yearText: string;
  if (year > 9999n) yearText = `+${year}`;
  else if (year < 0n) yearText = `-${pad(-year, 4)}`;
  else yearText = pad(year, 4);
  const hh = Math.floor(secondOfDay / 3600);
  const mm = Math.floor((secondOfDay % 3600) / 60);
  const ss = secondOfDay % 60;
  let fraction = "";
  if (nanos !== 0) {
    if (nanos % 1_000_000 === 0) fraction = `.${pad(nanos / 1_000_000, 3)}`;
    else if (nanos % 1000 === 0) fraction = `.${pad(nanos / 1000, 6)}`;
    else fraction = `.${pad(nanos, 9)}`;
  }
  return `${yearText}-${pad(month, 2)}-${pad(day, 2)}T${pad(hh, 2)}:${pad(mm, 2)}:${pad(ss, 2)}${fraction}Z`;
}
