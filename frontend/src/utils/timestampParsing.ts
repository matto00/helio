// HEL-1640 — the one TypeScript reader of "which instant does this string denote", with the engine's
// semantics. It mirrors backend `TimestampParsing.parseInstant` (a String input); the chart x axis
// (`parseChartInstant`) and the client step evaluator (`parseInstantString`) both read through it, and
// shared-test-fixtures/chart-timestamp-parsing.json pins it to the Scala parser case by case. Echarts-free
// (HEL-512): it is part of the main bundle. Never `Date.parse` a time-zone-less string: JS reads it as LOCAL time.
//
// The engine's order is: `value.toString.trim`, then `epochOf` (a whole `Long` / `BigDecimal`, which
// accept any Unicode decimal digit), else `parseNonEpochInstant` (formatters and regexes that are
// ASCII-digit only). The epoch arm can run first without a fall-through: no whole-number decimal string
// can match a non-epoch shape, every one of which needs `dddd-dd-dd` or `dd/dd/dddd`.

// `javaNumbers.ts` is a dependency-free leaf module (no imports), so this utils -> feature import pulls no
// evaluator code into the main bundle.
import { digitValue, javaTrim } from "../features/pipelines/evaluator/javaNumbers";

/** An instant as epoch seconds (floor) plus a 0..999,999,999 nanosecond-of-second. */
export interface InstantParts {
  seconds: bigint;
  nanos: number;
}

const EPOCH_MILLIS_THRESHOLD = 9999999999n;
const LONG_MIN = -(2n ** 63n);
const LONG_MAX = 2n ** 63n - 1n;
const MAX_SCALE_MAGNITUDE = 40;
// Epochs are bounded to years 0001-01-01T00:00:00Z .. 9999-12-31T23:59:59.999Z (HEL-1502 D5).
const MIN_EPOCH_SECONDS = -62135596800n;
const MAX_EPOCH_SECONDS = 253402300799n;
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
const ISO_LOCAL = new RegExp(`^${DATE}[Tt ]${TIME}${FRACTION}$`);
const ISO_DATE = new RegExp(`^${DATE}$`);
const US_DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

const floorDiv = (a: bigint, b: bigint): bigint => {
  const q = a / b;
  return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q;
};

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
  if (!Number.isFinite(scale) || Math.abs(scale) > MAX_SCALE_MAGNITUDE) return undefined;
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

/** `TimestampParsing.epochOf` for a String: `Long.parseLong(trim)`, else a whole `BigDecimal`; bounded to
 *  0001-9999. `null` when the string is not a whole number, `undefined` when it is one out of range. */
function epochOfString(trimmed: string): InstantParts | undefined | null {
  // `Long.parseLong` accepts a subset of what the whole-`BigDecimal` arm accepts, with the same value.
  const epoch = wholeLongOfDecimal(trimmed);
  if (epoch === undefined) return null;
  const millisUnit = epoch > EPOCH_MILLIS_THRESHOLD || epoch < -EPOCH_MILLIS_THRESHOLD;
  const seconds = millisUnit ? floorDiv(epoch, 1000n) : epoch;
  const nanos = millisUnit ? Number(epoch - seconds * 1000n) * 1_000_000 : 0;
  if (seconds < MIN_EPOCH_SECONDS || seconds > MAX_EPOCH_SECONDS) return undefined;
  return { seconds, nanos };
}

/** Epoch seconds (UTC) of a civil date-time, or `null` for an impossible one. Never clamps or rolls. */
function utcSeconds(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number | null {
  if (y < 1 || h > 23 || mi > 59 || s > 59) return null;
  const date = new Date(0);
  date.setUTCFullYear(y, mo - 1, d);
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return date.setUTCHours(h, mi, s, 0) / 1000;
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

const parts = (seconds: number, fraction = ""): InstantParts => ({
  seconds: BigInt(seconds),
  nanos: Number(fraction.padEnd(9, "0")),
});

/** The shapes that are not a whole number: ISO instants and offset date-times, Postgres numeric offsets
 *  (`+HH`, `+HHMM`, `+HH:MM`, `+HH:MM:SS`) on a `T` or space separator, a `[Region/Id]` suffix read at the
 *  written offset, time-zone-less date-times read as UTC, bare `yyyy-MM-dd` and `MM/dd/yyyy` as midnight
 *  UTC. A written year is bounded to 0001-9999 (HEL-1532: `0000` is not a timestamp). */
function parseNonEpoch(s: string): InstantParts | undefined {
  const zoned = ISO_ZONED.exec(s);
  if (zoned) {
    const [, y, mo, d, separator, h, mi, sec, fraction, offset] = zoned;
    if (separator === " " && offset.toUpperCase() === "Z") return undefined;
    if (fraction !== undefined && sec === undefined) return undefined; // the backend's fraction needs seconds
    const local = utcSeconds(+y, +mo, +d, +h, +mi, sec ? +sec : 0);
    const shift = offsetSeconds(offset);
    return local === null || shift === null ? undefined : parts(local - shift, fraction);
  }
  const local = ISO_LOCAL.exec(s);
  if (local) {
    const [, y, mo, d, h, mi, sec, fraction] = local;
    if (fraction !== undefined && sec === undefined) return undefined; // the backend's fraction needs seconds
    const t = utcSeconds(+y, +mo, +d, +h, +mi, sec ? +sec : 0);
    return t === null ? undefined : parts(t, fraction);
  }
  const date = ISO_DATE.exec(s);
  if (date) {
    const t = utcSeconds(+date[1], +date[2], +date[3]);
    return t === null ? undefined : parts(t);
  }
  const us = US_DATE.exec(s);
  if (us) {
    const t = utcSeconds(+us[3], +us[1], +us[2]);
    return t === null ? undefined : parts(t);
  }
  return undefined;
}

/** The instant a string denotes (`TimestampParsing.parseInstant` on a String), or `undefined`. Never
 *  clamps, rolls or folds (`24:00`, `:60` and impossible dates are `undefined`, as is a fraction without
 *  seconds). Never throws. */
export function parseInstantParts(raw: string): InstantParts | undefined {
  // Java `trim` strips code units <= U+0020 only; a string still padded with other whitespace (U+00A0) is
  // not a timestamp on the JVM.
  const s = javaTrim(raw);
  if (s === "" || s !== s.trim()) return undefined;
  const epoch = epochOfString(s);
  if (epoch !== null) return epoch;
  return parseNonEpoch(s);
}
