// HEL-1581 — rename, select, limit, dedupe, unpivot (ports of the same-named Scala steps).

import {
  asObject,
  int,
  normalizeEnum,
  stringArray,
  stringMap,
  str,
  unsupportedEnum,
} from "../config";
import { KeyBuilder, scalaMapKeyOrder } from "../scalaGroup";
import { cell, put, putLast, type Row, type Value } from "../value";
import type { StepHandler } from "./types";

const hasOwn = Object.prototype.hasOwnProperty;

// --- rename ------------------------------------------------------------------------------------------

interface RenameConfig {
  /** `[from, to]` in the order Scala folds them (sorted key order up to four, hash order beyond). */
  renames: Array<[string, string]>;
}

export const renameHandler: StepHandler<RenameConfig> = {
  stepClass: "client",
  decode(raw) {
    const map = stringMap(asObject(raw), "renames", "from-field-name to to-field-name");
    return {
      renames: scalaMapKeyOrder(Object.keys(map)).map((from): [string, string] => [
        from,
        map[from],
      ]),
    };
  },
  problems: () => [],
  apply(rows, { renames }) {
    return rows.map((row) => renameRow(row, renames));
  },
};

/**
 * The keys of `names` after the renames, each in the position of the column it came from (HEL-1732 D2; the server's analyze maps
 * every column in place). The renames are folded in the given order, as Scala folds them: a rename onto a column that is there
 * overwrites it (the survivor keeps the earlier of the two positions), a chain `a->b, b->c` ends as `c`.
 */
export function renameKeyOrder(
  names: readonly string[],
  renames: ReadonlyArray<[string, string]>,
): string[] {
  const entries = names.map((name, origin) => ({ name, origin }));
  const order = foldRenames(entries, renames);
  return order.map((e) => e.name);
}

/** Shared by `renameKeyOrder` and `renameRow`: the entries after the folds, each still carrying where its value comes from. */
function foldRenames<E extends { name: string; origin: number }>(
  entries: E[],
  renames: ReadonlyArray<[string, string]>,
): E[] {
  for (const [from, to] of renames) {
    const at = entries.findIndex((e) => e.name === from);
    if (at < 0) continue;
    const other = entries.findIndex((e, i) => i !== at && e.name === to);
    if (other < 0) {
      entries[at] = { ...entries[at], name: to };
    } else if (at < other) {
      entries[at] = { ...entries[at], name: to };
      entries.splice(other, 1);
    } else {
      entries[other] = { ...entries[at], name: to };
      entries.splice(at, 1);
    }
  }
  return entries;
}

function renameRow(row: Row, renames: ReadonlyArray<[string, string]>): Row {
  const keys = Object.keys(row);
  if (!renames.some(([from]) => hasOwn.call(row, from))) return { ...row };
  const entries = foldRenames(
    keys.map((name, origin) => ({ name, origin })),
    renames,
  );
  const out: Record<string, Value> = {};
  for (const e of entries) put(out, e.name, row[keys[e.origin]]);
  return out;
}

// --- select ------------------------------------------------------------------------------------------

export const selectHandler: StepHandler<{ fields: string[] }> = {
  stepClass: "client",
  decode: (raw) => ({ fields: stringArray(asObject(raw), "fields") }),
  problems: () => [],
  apply(rows, { fields }) {
    const keep = new Set(fields);
    return rows.map((row) => {
      const out: Record<string, Value> = {};
      for (const key of Object.keys(row)) if (keep.has(key)) put(out, key, row[key]);
      return out;
    });
  },
};

// --- limit -------------------------------------------------------------------------------------------

export const limitHandler: StepHandler<{ count: number }> = {
  stepClass: "client",
  decode: (raw) => ({ count: int(asObject(raw), "count", 0) }),
  problems: () => [],
  apply: (rows, { count }) => (count <= 0 ? rows : rows.slice(0, count)),
};

// --- dedupe ------------------------------------------------------------------------------------------

const KEEP = ["first", "last"] as const;

interface DedupeConfig {
  keys: string[];
  keep: string;
}

/** Equality key of a row: the key fields' values, or the whole row as field-sorted (field, value) pairs. */
function dedupeKey(row: Row, keys: readonly string[], builder: KeyBuilder): string {
  if (keys.length > 0) return builder.tuple(keys.map((k) => cell(row, k)));
  const fields = Object.keys(row).sort();
  return fields.map((f) => `${f.length}:${f}=${builder.scalar(row[f])}`).join("|");
}

export const dedupeHandler: StepHandler<DedupeConfig> = {
  stepClass: "client",
  decode(raw) {
    const obj = asObject(raw);
    return { keys: stringArray(obj, "keys"), keep: normalizeEnum(str(obj, "keep", "first"), KEEP) };
  },
  problems: (c) => unsupportedEnum("dedupe", "keep", c.keep, KEEP),
  apply(rows, { keys, keep }) {
    const builder = new KeyBuilder();
    const rowKeys = rows.map((row) => dedupeKey(row, keys, builder));
    if (keep === "last") {
      const lastIndex = new Map<string, number>();
      rowKeys.forEach((key, idx) => lastIndex.set(key, idx));
      return rows.filter((_row, idx) => lastIndex.get(rowKeys[idx]) === idx);
    }
    const seen = new Set<string>();
    return rows.filter((_row, idx) => {
      if (seen.has(rowKeys[idx])) return false;
      seen.add(rowKeys[idx]);
      return true;
    });
  },
};

// --- unpivot -----------------------------------------------------------------------------------------

interface UnpivotConfig {
  idVars: string[];
  valueVars: string[];
  varName: string;
  valueName: string;
}

export const unpivotHandler: StepHandler<UnpivotConfig> = {
  stepClass: "client",
  decode(raw) {
    const obj = asObject(raw);
    return {
      idVars: stringArray(obj, "idVars"),
      valueVars: stringArray(obj, "valueVars"),
      varName: str(obj, "varName", "variable"),
      valueName: str(obj, "valueName", "value"),
    };
  },
  problems: () => [],
  apply(rows, { idVars, valueVars, varName, valueName }) {
    const out: Row[] = [];
    for (const row of rows) {
      for (const valueVar of valueVars) {
        const next: Record<string, Value> = {};
        for (const id of idVars) put(next, id, cell(row, id));
        putLast(next, varName, valueVar);
        putLast(next, valueName, cell(row, valueVar));
        out.push(next);
      }
    }
    return out;
  },
};
