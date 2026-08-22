// schedulePreview — client-side helpers for PipelineScheduleDialog (F-140):
// friendly interval/cron validation, a minimal standard-cron ("vixie cron",
// 5-field) next-run calculator, and IANA timezone validation. Deliberately
// self-contained (no dependency) per the dialog's existing "a friendlier cron
// widget would need a new dependency (non-goal)" stance — this covers the
// common subset (`*`, lists, ranges, `/step`) used by the dialog's own
// presets and the vast majority of real-world cron expressions, and simply
// declines to produce a preview (returns `null`) for anything it can't
// confidently resolve within a bounded search window, rather than guessing.
//
// The cron preview is computed in the *browser's* local time (plain `Date`
// getters), not the schedule's configured `timezone` field — true
// timezone-aware cron evaluation (DST-aware wall-clock → UTC instant
// conversion) needs a real time zone database library, which is exactly the
// dependency this dialog's header comment already rules out. Callers must
// present the cron preview as an approximation (see
// PipelineScheduleDialog.tsx's "your local time zone" caption).

const CRON_FIELD_RANGES: readonly [number, number][] = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day-of-month
  [1, 12], // month
  [0, 6], // day-of-week
];

const CRON_FIELD_NAMES = ["minute", "hour", "day-of-month", "month", "day-of-week"] as const;

/** Expands one cron field — a wildcard, a single value, a range ("N-M"), any
 *  of those with a step suffix ("/K"), or a comma-list of the above — into
 *  the set of matching values within `[min, max]`. Returns `null` for
 *  anything outside that grammar or out of range — the caller treats `null`
 *  as "invalid". */
function parseCronField(field: string, min: number, max: number): Set<number> | null {
  const values = new Set<number>();
  for (const part of field.split(",")) {
    const match = /^(\*|\d+-\d+|\d+)(\/(\d+))?$/.exec(part);
    if (!match) return null;
    const [, base, , stepStr] = match;
    const step = stepStr ? Number.parseInt(stepStr, 10) : 1;
    if (step <= 0) return null;

    let rangeStart: number;
    let rangeEnd: number;
    if (base === "*") {
      rangeStart = min;
      rangeEnd = max;
    } else if (base.includes("-")) {
      const [a, b] = base.split("-").map((n) => Number.parseInt(n, 10));
      if (a > b) return null;
      rangeStart = a;
      rangeEnd = b;
    } else {
      const v = Number.parseInt(base, 10);
      // A bare "N/step" (e.g. "5/15") means "starting at N, every step unit,
      // up to the field's max" — the standard cron reading. A bare "N" with
      // no step is just that one value.
      rangeStart = v;
      rangeEnd = stepStr ? max : v;
    }
    if (rangeStart < min || rangeEnd > max) return null;
    for (let v = rangeStart; v <= rangeEnd; v += step) values.add(v);
  }
  return values;
}

/** Validates a 5-field cron expression client-side, returning a friendly
 *  inline-error message (or `null` if it looks well-formed). This is
 *  deliberately not a full cron grammar validator — it exists to catch the
 *  common typos (wrong field count, an out-of-range or malformed field)
 *  before a 400 round-trip, matching what the backend's own pattern accepts
 *  for the subset this dialog exposes (presets + free text). */
export function validateCronExpression(expression: string): string | null {
  const trimmed = expression.trim();
  if (trimmed === "") return "Cron expression is required.";
  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) {
    return `Cron expression must have 5 fields (found ${fields.length}): minute hour day-of-month month day-of-week.`;
  }
  for (let i = 0; i < 5; i++) {
    const [min, max] = CRON_FIELD_RANGES[i];
    const parsed = parseCronField(fields[i], min, max);
    if (parsed === null || parsed.size === 0) {
      return `Field ${i + 1} ("${fields[i]}", ${CRON_FIELD_NAMES[i]}) must be between ${min} and ${max}.`;
    }
  }
  return null;
}

/** Search bound for `computeCronNextRun` — one non-leap year of minutes.
 *  Comfortably covers every preset (hourly/daily/weekly/monthly) and the
 *  overwhelming majority of hand-written expressions; a cron that can't
 *  fire within a year (e.g. Feb 30th) legitimately has no next run. */
const MAX_SEARCH_MINUTES = 366 * 24 * 60;

/** Computes the next local-time instant a 5-field cron expression matches,
 *  starting strictly after `from`. Returns `null` for an invalid expression
 *  or one with no match inside the search bound. See file header re: this
 *  being a local-time approximation, not a timezone-aware evaluation. */
export function computeCronNextRun(expression: string, from: Date = new Date()): Date | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;

  const parsedFields = fields.map((field, i) =>
    parseCronField(field, CRON_FIELD_RANGES[i][0], CRON_FIELD_RANGES[i][1]),
  );
  if (parsedFields.some((s) => s === null || s.size === 0)) return null;
  const [minutes, hours, daysOfMonth, months, daysOfWeek] = parsedFields as Set<number>[];

  const domIsWildcard = fields[2] === "*";
  const dowIsWildcard = fields[4] === "*";

  const cursor = new Date(from);
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  for (let i = 0; i < MAX_SEARCH_MINUTES; i++) {
    const dayMatches = domIsWildcard
      ? dowIsWildcard || daysOfWeek.has(cursor.getDay())
      : dowIsWildcard
        ? daysOfMonth.has(cursor.getDate())
        : daysOfMonth.has(cursor.getDate()) || daysOfWeek.has(cursor.getDay());

    if (
      minutes.has(cursor.getMinutes()) &&
      hours.has(cursor.getHours()) &&
      months.has(cursor.getMonth() + 1) &&
      dayMatches
    ) {
      return new Date(cursor);
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return null;
}

const INTERVAL_UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** Computes the next run instant for an interval schedule (`n` positive,
 *  `unit` one of s/m/h/d) — exact, since "N units from now" needs no
 *  calendar/timezone reasoning (an absolute instant renders correctly in any
 *  timezone). Returns `null` for a non-positive `n` or unrecognized unit. */
export function computeIntervalNextRun(
  n: number,
  unit: string,
  from: Date = new Date(),
): Date | null {
  const unitMs = INTERVAL_UNIT_MS[unit];
  if (unitMs === undefined || !Number.isFinite(n) || n < 1) return null;
  return new Date(from.getTime() + n * unitMs);
}

/** Validates an IANA timezone name via the runtime's own tz database
 *  (`Intl.DateTimeFormat` throws `RangeError` for an unrecognized zone) —
 *  no hardcoded zone list to maintain. */
export function isValidTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** All IANA zone names the runtime knows about, for the timezone field's
 *  `<datalist>` suggestions. `Intl.supportedValuesOf` isn't implemented in
 *  every environment (notably jsdom in tests) — degrades to an empty list,
 *  which just means no autocomplete suggestions rather than a crash. */
export function supportedTimezones(): string[] {
  try {
    return typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  } catch {
    return [];
  }
}
