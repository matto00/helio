// HEL-1190 design.md D2/D3 — pure encode/decode/compose logic for a viewer's control selection,
// deliberately kept free of React so it can be unit-tested directly and reused by both
// `useViewerControls` (the URL-state hook) and the request-builder call sites that compose a
// control's effective value into `OutputRowsFilter.ops[]`.

import type { OutputControlKind, OutputControlSpec } from "../types/panel";
import type { OutputRowsFilterOp } from "../../pipelines/services/outputService";

export type DateRangePresetToken = "last7d" | "last30d" | "thisQuarter";
const DATE_RANGE_PRESET_TOKENS: ReadonlySet<string> = new Set(["last7d", "last30d", "thisQuarter"]);

export function isDateRangePresetToken(value: string): value is DateRangePresetToken {
  return DATE_RANGE_PRESET_TOKENS.has(value);
}

export interface DateRangeCustomValue {
  from: string | null;
  to: string | null;
}
export type DateRangeValue = { preset: DateRangePresetToken } | DateRangeCustomValue;

function isPresetValue(value: DateRangeValue): value is { preset: DateRangePresetToken } {
  return "preset" in value;
}

/** design.md D2 — resolves a preset token into concrete ISO `{from, to}` bounds, computed from
 *  `now` at REQUEST-BUILD time (never persisted as absolute dates in the URL — only the preset
 *  TOKEN itself is encoded there) so a reload or a pasted link always re-derives "last 7 days"
 *  relative to today, never whatever day the link was minted. */
export function resolveDateRangePreset(
  preset: DateRangePresetToken,
  now: Date,
): { from: string; to: string } {
  const to = now.toISOString();
  if (preset === "thisQuarter") {
    const quarterStartMonth = Math.floor(now.getUTCMonth() / 3) * 3;
    const from = new Date(Date.UTC(now.getUTCFullYear(), quarterStartMonth, 1)).toISOString();
    return { from, to };
  }
  const days = preset === "last7d" ? 7 : 30;
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - days);
  return { from: from.toISOString(), to };
}

/** design.md D2 — `<from>_<to>` (ISO dates, empty side for open-ended) OR a bare preset token.
 *  Returns `undefined` for anything malformed — the caller treats that identically to "absent"
 *  (falls back to the author's default), never a render error (spec.md). */
export function parseDateRangeRaw(raw: string): DateRangeValue | undefined {
  if (isDateRangePresetToken(raw)) return { preset: raw };
  const idx = raw.indexOf("_");
  if (idx === -1) return undefined;
  const fromRaw = raw.slice(0, idx);
  const toRaw = raw.slice(idx + 1);
  if (
    (fromRaw !== "" && Number.isNaN(Date.parse(fromRaw))) ||
    (toRaw !== "" && Number.isNaN(Date.parse(toRaw)))
  )
    return undefined;
  return { from: fromRaw === "" ? null : fromRaw, to: toRaw === "" ? null : toRaw };
}

export function encodeDateRangeValue(value: DateRangeValue): string {
  if (isPresetValue(value)) return value.preset;
  return `${value.from ?? ""}_${value.to ?? ""}`;
}

export interface NumericRangeValue {
  min: number | null;
  max: number | null;
}

/** `<min>_<max>` — empty side for open-ended. `undefined` for anything malformed. */
export function parseNumericRangeRaw(raw: string): NumericRangeValue | undefined {
  const idx = raw.indexOf("_");
  if (idx === -1) return undefined;
  const minRaw = raw.slice(0, idx);
  const maxRaw = raw.slice(idx + 1);
  const min = minRaw === "" ? null : Number(minRaw);
  const max = maxRaw === "" ? null : Number(maxRaw);
  if ((min !== null && Number.isNaN(min)) || (max !== null && Number.isNaN(max))) return undefined;
  return { min, max };
}

export function encodeNumericRangeValue(value: NumericRangeValue): string {
  return `${value.min ?? ""}_${value.max ?? ""}`;
}

/** design.md D2 — whether `raw` is a well-formed URL-string encoding for `kind`. `text`/
 *  `dropdown` accept any string (the raw value IS the value); `numeric-range`/`date-range` must
 *  parse. A `false` result is what makes a malformed URL entry fall back to the author's default
 *  rather than erroring (spec.md's "never a render error"). */
export function isValidRawValue(kind: OutputControlKind, raw: string): boolean {
  switch (kind) {
    case "text":
    case "dropdown":
      return true;
    case "numeric-range":
      return parseNumericRangeRaw(raw) !== undefined;
    case "date-range":
      return parseDateRangeRaw(raw) !== undefined;
  }
}

/** design.md D2 — the author's configured `defaultValue`, re-encoded into the SAME raw-string
 *  shape a URL entry would carry, or `undefined` when there is no default (i.e. "no filter" is
 *  the effective value). Never throws on a malformed/legacy `defaultValue` shape — falls back to
 *  `undefined` (no filter) rather than a render error. */
export function encodeDefaultValue(control: OutputControlSpec): string | undefined {
  const { kind, defaultValue } = control;
  if (defaultValue === undefined || defaultValue === null) return undefined;
  try {
    switch (kind) {
      case "text":
      case "dropdown":
        return typeof defaultValue === "string" && defaultValue !== "" ? defaultValue : undefined;
      case "numeric-range": {
        const v = defaultValue as Partial<NumericRangeValue>;
        if (v.min == null && v.max == null) return undefined;
        return encodeNumericRangeValue({ min: v.min ?? null, max: v.max ?? null });
      }
      case "date-range": {
        const v = defaultValue as Partial<DateRangeCustomValue>;
        if (v.from == null && v.to == null) return undefined;
        return encodeDateRangeValue({ from: v.from ?? null, to: v.to ?? null });
      }
    }
  } catch {
    return undefined;
  }
}

/** design.md D3 — translates every non-orphaned control's CURRENTLY EFFECTIVE raw value (a URL
 *  entry, or the author's default) into HEL-1188 `ops[]` entries: `eq` for `text`/`dropdown`
 *  (exact match on the typed/selected value — see files-modified.md's scope note on why this is
 *  `eq`, not `contains`), `gte`/`lte` for `numeric-range`/`date-range` (a preset resolved against
 *  `now` first). A control with no effective value (raw `undefined`, or a malformed raw value)
 *  contributes nothing to the result. Orphaned controls are the CALLER's job to have already
 *  excluded from `controls` (mirrors `OutputViewerControlBar`'s own filter) — this function does
 *  not re-check orphan status itself. */
export function buildViewerControlFilterOps(
  controls: OutputControlSpec[],
  values: Record<string, string | undefined>,
  now: Date = new Date(),
): OutputRowsFilterOp[] {
  const ops: OutputRowsFilterOp[] = [];
  for (const control of controls) {
    const raw = values[control.id];
    if (raw === undefined) continue;
    switch (control.kind) {
      case "text":
      case "dropdown":
        if (raw !== "") ops.push({ column: control.column, op: "eq", value: raw });
        break;
      case "numeric-range": {
        const parsed = parseNumericRangeRaw(raw);
        if (!parsed) break;
        if (parsed.min !== null)
          ops.push({ column: control.column, op: "gte", value: String(parsed.min) });
        if (parsed.max !== null)
          ops.push({ column: control.column, op: "lte", value: String(parsed.max) });
        break;
      }
      case "date-range": {
        const parsed = parseDateRangeRaw(raw);
        if (!parsed) break;
        const resolved = isPresetValue(parsed)
          ? resolveDateRangePreset(parsed.preset, now)
          : parsed;
        if (resolved.from) ops.push({ column: control.column, op: "gte", value: resolved.from });
        if (resolved.to) ops.push({ column: control.column, op: "lte", value: resolved.to });
        break;
      }
    }
  }
  return ops;
}
