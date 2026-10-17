// HEL-1581 — port of `ExpressionDateTimeFunctions.scala`: `seconds_between`, `date_trunc`, `add_days`.
// Each timestamp argument is read through the shared parse and interpreted in UTC; a value it rejects
// makes the row's result `null`.

import {
  civilFromEpochDay,
  epochDayFromCivil,
  epochDayOf,
  epochInstantOfNumber,
  formatInstant,
  mondayIndex,
  parseInstantString,
  type InstantParts,
} from "../instants";
import { decimalOf } from "./decimal";
import { EvalError, type Val } from "./types";

const MIN_INSTANT_SECOND = -31557014167219200n;
const MAX_INSTANT_SECOND = 31556889864403199n;

function instantOf(v: Val): InstantParts | undefined {
  if (typeof v === "string") return parseInstantString(v);
  if (typeof v === "number") return epochInstantOfNumber(v);
  return undefined;
}

export function secondsBetween(end: Val, start: Val): Val {
  const e = instantOf(end);
  const s = instantOf(start);
  if (!e || !s) return null;
  let seconds = e.seconds - s.seconds;
  let nanos = e.nanos - s.nanos;
  if (nanos < 0) {
    seconds -= 1n;
    nanos += 1_000_000_000;
  }
  return Number(seconds) + nanos / 1e9 + 0;
}

function atDate(
  i: InstantParts,
  floor: (year: bigint, month: number, day: number, epochDay: bigint) => bigint,
): InstantParts {
  const epochDay = epochDayOf(i.seconds);
  const { year, month, day } = civilFromEpochDay(epochDay);
  return { seconds: floor(year, month, day, epochDay) * 86400n, nanos: 0 };
}

function truncate(unit: string, i: InstantParts): InstantParts {
  const whole = (size: bigint): InstantParts => ({
    seconds: (i.seconds / size - (i.seconds % size < 0n ? 1n : 0n)) * size,
    nanos: 0,
  });
  switch (unit) {
    case "second":
      return { seconds: i.seconds, nanos: 0 };
    case "minute":
      return whole(60n);
    case "hour":
      return whole(3600n);
    case "day":
      return whole(86400n);
    case "week":
      return atDate(i, (_y, _m, _d, epochDay) => epochDay - BigInt(mondayIndex(epochDay)));
    case "month":
      return atDate(i, (y, m) => epochDayFromCivil(y, m, 1));
    case "quarter":
      return atDate(i, (y, m) => epochDayFromCivil(y, Math.floor((m - 1) / 3) * 3 + 1, 1));
    default:
      return atDate(i, (y) => epochDayFromCivil(y, 1, 1));
  }
}

export function dateTrunc(unit: Val, ts: Val): Val {
  if (typeof unit !== "string") throw new EvalError("date_trunc unit");
  const i = instantOf(ts);
  return i ? formatInstant(truncate(unit, i)) : null;
}

/** `ts + days * 86400` seconds, rounded half-up to the nanosecond. */
export function addDays(ts: Val, n: Val): Val {
  if (typeof n !== "number") throw new EvalError("add_days requires a numeric day count");
  const i = instantOf(ts);
  if (!i || !Number.isFinite(n)) return null;
  const { digits, exponent, negative } = decimalOf(n);
  // days * 86400 * 10^9 nanoseconds, with the decimal exponent applied exactly and rounded HALF_UP.
  const scaled = digits * 86400n;
  const shift = exponent + 9;
  let nanosTotal: bigint;
  if (shift >= 0) {
    nanosTotal = scaled * 10n ** BigInt(shift);
  } else {
    const divisor = 10n ** BigInt(-shift);
    const q = scaled / divisor;
    nanosTotal = (scaled % divisor) * 2n >= divisor ? q + 1n : q;
  }
  if (negative) nanosTotal = -nanosTotal;
  let wholeSeconds = nanosTotal / 1_000_000_000n;
  let remainder = nanosTotal % 1_000_000_000n;
  if (remainder < 0n) {
    wholeSeconds -= 1n;
    remainder += 1_000_000_000n;
  }
  let seconds = i.seconds + wholeSeconds;
  let nanos = i.nanos + Number(remainder);
  if (nanos >= 1_000_000_000) {
    seconds += 1n;
    nanos -= 1_000_000_000;
  }
  if (seconds < MIN_INSTANT_SECOND || seconds > MAX_INSTANT_SECOND) return null;
  return formatInstant({ seconds, nanos });
}
