// HEL-469 — per-column format-selection state for the Output editor's Table
// kind fields. Mirrors `useOutputTableColumns.ts`'s shape (a thin `useState`
// wrapper, no persistence of its own — persistence is Save-path only, see
// `buildOutputConfig.ts`/design D1a). Only the format TYPE is editable here;
// `decimals`/`currency`/`datePattern` are left at their formatter defaults
// for a column that had no prior spec — a deliberately smaller control
// surface than the full spec shape supports, not a limit of the spec
// itself.
//
// evaluation-2.md non-blocking finding: a prior version of this hook rebuilt
// every entry as `{ type }` ONLY, discarding a spec's other fields
// (`decimals`/`currency`/`datePattern`) on ANY unrelated Save — those
// fields exist by other paths (the MCP server, the API, agent-authored
// proposals write Output config directly), so a bare visibility toggle
// followed by Save was silent data loss for a column this editor never
// even touched. Fixed by carrying the FULL spec object forward per column
// (`specs` state below) and changing only the `type` field the control
// actually edits — never inventing a default for an absent sub-option (an
// absent `currency` means "formatter default"; a written `"USD"` is a
// claim the user never made).

import { useState } from "react";

import type {
  TableColumnFormats,
  TableColumnFormatSpec,
  TableColumnFormatType,
} from "./outputConfigTypes";

/** `"none"` is the UI's own "no format" sentinel — never persisted; a
 *  column selected `"none"` has no entry in `specs` at all. */
export type ColumnFormatSelection = TableColumnFormatType | "none";

export interface OutputColumnFormatsState {
  /** Keyed by column name; a column with no entry is treated as `"none"`.
   *  Derived from `specs`, not stored independently, so it can never drift
   *  out of sync with what actually gets persisted. */
  selections: Record<string, ColumnFormatSelection>;
  setFormat: (key: string, type: ColumnFormatSelection) => void;
  /** design D3b — ALWAYS the full map, including an intentionally EMPTY one
   *  (`{}`) when every column is `"none"`, so `buildOutputConfig`'s
   *  whole-key-replace-on-Save clears a previously-set format rather than
   *  leaving it in `mergeConfig`'s shallow-merged, omitted-key-survives
   *  storage (see design D1a/D3b — never rely on omission to clear). */
  columnFormats: TableColumnFormats;
}

export function useOutputColumnFormats(
  initial: TableColumnFormats | undefined,
): OutputColumnFormatsState {
  // The FULL spec per column, seeded from whatever was already persisted
  // (including sub-options this editor never exposes a control for) — this
  // is the fix: state carries the whole `TableColumnFormatSpec`, not just
  // its `type`, so an untouched column's `decimals`/`currency`/
  // `datePattern` survive every Save regardless of which OTHER column the
  // user actually edited.
  const [specs, setSpecs] = useState<TableColumnFormats>(() => ({ ...(initial ?? {}) }));

  const setFormat = (key: string, type: ColumnFormatSelection) =>
    setSpecs((prev) => {
      if (type === "none") {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      }
      // Carry forward every OTHER field of the existing spec (if any) —
      // only `type` is what this control edits. A column with no prior
      // spec gets exactly `{ type }`, same as before; a column that
      // already had e.g. `{ type: "currency", currency: "EUR" }` keeps
      // `currency: "EUR"` even if the user switches it to `"number"` (the
      // formatter simply ignores a field its type doesn't use — see
      // `columnFormatting.ts`).
      const existing = prev[key];
      const nextSpec: TableColumnFormatSpec = existing ? { ...existing, type } : { type };
      return { ...prev, [key]: nextSpec };
    });

  const selections: Record<string, ColumnFormatSelection> = {};
  for (const [key, spec] of Object.entries(specs)) selections[key] = spec.type;

  return { selections, setFormat, columnFormats: specs };
}
