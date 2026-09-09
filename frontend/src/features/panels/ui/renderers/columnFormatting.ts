// HEL-469 — formatter functions mapping a per-column `TableColumnFormatSpec`
// + raw value to display text (design D2/D3). Consumed by BOTH the render
// path (`TableRenderer` → `ColumnDef.render`) and the filter path
// (`tableFilterPredicate`) through ONE resolver (design D6b) so the two can
// never drift. Sort does NOT use this module — it reads raw values
// (`TableRenderer.tsx:243`), and that asymmetry is deliberate (design D6).

import { formatCell } from "../../../../shared/ui/index";
import type { TableColumnFormatSpec } from "../../../pipelines/ui/outputEditor/outputConfigTypes";

/** Test-only override — production NEVER passes this (design D4: tests pin
 *  locale/timezone explicitly; production keeps locale-aware `Intl`
 *  defaults, i.e. `undefined` locale/timeZone). */
export interface FormatIntlOptions {
  locale?: string;
  timeZone?: string;
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return undefined;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function toValidDate(value: unknown): Date | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (typeof value === "number" || typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  return undefined;
}

/** design D3 — NEVER THROW; a value that cannot be interpreted as the
 *  column's format type falls back to `formatCell(value)` exactly (the
 *  existing `—`-for-null / JSON.stringify-for-object / String-otherwise
 *  behavior), so applying a format spec can never render a cell WORSE than
 *  no spec. */
export function formatColumnValue(
  spec: TableColumnFormatSpec | undefined,
  value: unknown,
  intl?: FormatIntlOptions,
): string {
  if (!spec) return formatCell(value);
  if (value === null || value === undefined) return formatCell(value);
  try {
    switch (spec.type) {
      case "text":
        return formatCell(value);
      case "number": {
        const n = toFiniteNumber(value);
        if (n === undefined) return formatCell(value);
        return new Intl.NumberFormat(intl?.locale, {
          minimumFractionDigits: spec.decimals,
          maximumFractionDigits: spec.decimals,
        }).format(n);
      }
      case "currency": {
        const n = toFiniteNumber(value);
        if (n === undefined) return formatCell(value);
        return new Intl.NumberFormat(intl?.locale, {
          style: "currency",
          currency: spec.currency ?? "USD",
          minimumFractionDigits: spec.decimals,
          maximumFractionDigits: spec.decimals,
        }).format(n);
      }
      case "date": {
        const d = toValidDate(value);
        if (d === undefined) return formatCell(value);
        return new Intl.DateTimeFormat(intl?.locale, {
          timeZone: intl?.timeZone,
          dateStyle: spec.datePattern ?? "medium",
        }).format(d);
      }
      default:
        return formatCell(value);
    }
  } catch {
    // Never throw (design D3/task 2.2) — an option combination `Intl`
    // itself rejects (e.g. a malformed currency code) degrades to the same
    // raw-string fallback as an unparseable value, not an error.
    return formatCell(value);
  }
}

/** design D6b — resolve a column's format spec into ONE `(value) => string`
 *  function, shared verbatim by the render path and the filter path so they
 *  can never silently diverge. Falls back to `formatCell` when no spec is
 *  given, so an unformatted column's resolver behaves exactly as
 *  `formatCell` did before this capability existed. */
export function resolveColumnFormatter(
  spec: TableColumnFormatSpec | undefined,
  intl?: FormatIntlOptions,
): (value: unknown) => string {
  return (value: unknown) => formatColumnValue(spec, value, intl);
}
