// HEL-1581 — join, union and lookup (ports of the same-named Scala steps and `JoinColumnNaming`). The
// second input is a lane (the already-evaluated frame of another step) or a source frame the caller
// cached and marked complete.

import {
  StepConfigError,
  StepConfigTypeMismatch,
  asObject,
  missingRequired,
  str,
  stringArray,
  type JsonObject,
} from "../config";
import { KeyBuilder } from "../scalaGroup";
import { cell, put, type Frame, type Row, type Value } from "../value";
import type { ClientDeclineReason, RunContext, StepHandler } from "./types";

const hasOwn = Object.prototype.hasOwnProperty;

// --- secondaryInput (SecondaryInput.scala) -------------------------------------------------------------

type SecondaryInput = { kind: "source"; dataSourceId: string } | { kind: "lane"; stepId: string };

function decodeSecondaryInput(obj: JsonObject, legacyField: string): SecondaryInput {
  if (hasOwn.call(obj, legacyField)) {
    throw new StepConfigTypeMismatch(
      `'${legacyField}' is no longer a valid config field. Use 'secondaryInput'.`,
    );
  }
  const raw = hasOwn.call(obj, "secondaryInput") ? obj.secondaryInput : undefined;
  if (raw === undefined || raw === null) return { kind: "source", dataSourceId: "" };
  if (typeof raw !== "object" || Array.isArray(raw))
    throw new StepConfigTypeMismatch("'secondaryInput' must be an object.");
  const o = raw as JsonObject;
  if (o.kind === "source") {
    if (typeof o.dataSourceId !== "string")
      throw new StepConfigTypeMismatch("'secondaryInput' needs a string 'dataSourceId'.");
    return { kind: "source", dataSourceId: o.dataSourceId };
  }
  if (o.kind === "lane") {
    if (typeof o.stepId !== "string")
      throw new StepConfigTypeMismatch("'secondaryInput' needs a string 'stepId'.");
    return { kind: "lane", stepId: o.stepId };
  }
  throw new StepConfigTypeMismatch(
    "'secondaryInput' requires a string 'kind' of 'source' or 'lane'.",
  );
}

/** A configured source secondary the caller has not cached completely cannot be evaluated here. */
function declineSecondary(si: SecondaryInput, ctx: RunContext): ClientDeclineReason | undefined {
  if (si.kind !== "source" || si.dataSourceId === "") return undefined;
  const cached = ctx.source(si.dataSourceId);
  return cached === undefined || !cached.complete ? "secondaryNotCached" : undefined;
}

function secondaryRows(si: SecondaryInput, ctx: RunContext, what: string): Frame {
  if (si.kind === "lane") {
    const rows = ctx.lane(si.stepId);
    if (rows === undefined)
      throw new StepConfigError(`Lane reference not found for ${what}: ${si.stepId}`);
    return rows;
  }
  const cached = ctx.source(si.dataSourceId);
  if (cached === undefined)
    throw new StepConfigError(`DataSource not found for ${what}: ${si.dataSourceId}`);
  return cached.rows;
}

/** `rows.flatMap(_.keys)`: every key of every row, in first-seen order. */
function allKeys(rows: Frame): string[] {
  const seen = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) seen.add(key);
  return [...seen];
}

// --- JoinColumnNaming.scala ----------------------------------------------------------------------------

const RIGHT_PREFIX = "right_";

/** right column name -> output name: untouched names stay, colliding ones get `right_` (+ `_2`, `_3`, ...). */
function resolveColumnNames(
  leftCols: readonly string[],
  rightCols: readonly string[],
  droppedKey: string | undefined,
): Map<string, string> {
  const left = new Set(leftCols);
  const right = [...new Set(rightCols)];
  const kept = right.filter((c) => !(c === droppedKey && left.has(c)));
  const untouched = kept.filter((c) => !left.has(c));
  const colliding = kept.filter((c) => left.has(c)).sort();
  const taken = new Set<string>([...left, ...untouched]);
  const mapping = new Map<string, string>(untouched.map((c) => [c, c]));
  for (const col of colliding) {
    let chosen = RIGHT_PREFIX + col;
    for (let n = 2; taken.has(chosen); n++) chosen = `${RIGHT_PREFIX}${col}_${n}`;
    mapping.set(col, chosen);
    taken.add(chosen);
  }
  return mapping;
}

function indexByKey(rows: Frame, field: string): { keys: KeyBuilder; index: Map<string, Row[]> } {
  const keys = new KeyBuilder();
  const index = new Map<string, Row[]>();
  for (const row of rows) {
    const key = keys.scalar(cell(row, field));
    const list = index.get(key);
    if (list) list.push(row);
    else index.set(key, [row]);
  }
  return { keys, index };
}

// --- join --------------------------------------------------------------------------------------------

interface JoinConfig {
  secondary: SecondaryInput;
  joinKey: string;
  joinType: string;
}

export const joinHandler: StepHandler<JoinConfig> = {
  stepClass: "client*",
  decode(raw) {
    const obj = asObject(raw);
    return {
      secondary: decodeSecondaryInput(obj, "rightDataSourceId"),
      joinKey: str(obj, "joinKey", ""),
      joinType: str(obj, "joinType", "inner"),
    };
  },
  problems: (c) => missingRequired("join", [["joinKey", c.joinKey]]),
  declines: (c, ctx) => declineSecondary(c.secondary, ctx),
  apply(rows, { secondary, joinKey, joinType }, ctx) {
    const right = secondaryRows(secondary, ctx, "join");
    const { keys, index } = indexByKey(right, joinKey);
    const mapping = resolveColumnNames(allKeys(rows), allKeys(right), joinKey);
    const normalized = joinType.toLowerCase();
    if (normalized !== "inner" && normalized !== "left") {
      throw new StepConfigError(`Unsupported join type: ${normalized}. Supported: inner, left`);
    }
    const merge = (leftRow: Row, rightRow: Row): Row => {
      const out: Record<string, Value> = { ...leftRow };
      for (const key of Object.keys(rightRow)) {
        const target = mapping.get(key);
        if (target !== undefined) put(out, target, rightRow[key]);
      }
      return out;
    };
    const out: Row[] = [];
    for (const leftRow of rows) {
      const matches = index.get(keys.scalar(cell(leftRow, joinKey))) ?? [];
      if (matches.length === 0) {
        if (normalized === "left") out.push(leftRow);
      } else {
        for (const rightRow of matches) out.push(merge(leftRow, rightRow));
      }
    }
    return out;
  },
};

// --- union -------------------------------------------------------------------------------------------

interface UnionConfig {
  secondary: SecondaryInput;
  mode: string;
}

function backfill(rows: Frame, missing: readonly string[]): Row[] {
  return rows.map((row) => {
    const out: Record<string, Value> = { ...row };
    for (const key of missing) put(out, key, null);
    return out;
  });
}

export const unionHandler: StepHandler<UnionConfig> = {
  stepClass: "client*",
  decode(raw) {
    const obj = asObject(raw);
    return {
      secondary: decodeSecondaryInput(obj, "otherDataSourceId"),
      mode: str(obj, "mode", "byPosition"),
    };
  },
  problems: () => [],
  declines: (c, ctx) => declineSecondary(c.secondary, ctx),
  apply(rows, { secondary, mode }, ctx) {
    const other = secondaryRows(secondary, ctx, "union");
    if (mode === "byPosition") return [...rows, ...other];
    if (mode !== "byName")
      throw new StepConfigError(`Unsupported union mode: ${mode}. Supported: byPosition, byName`);
    // Only the FIRST row of each side decides the key set (a later row's extra keys are overwritten by null).
    const currentKeys = rows.length > 0 ? Object.keys(rows[0]) : [];
    const otherKeys = other.length > 0 ? Object.keys(other[0]) : [];
    const union = [...new Set([...currentKeys, ...otherKeys])];
    const currentSet = new Set(currentKeys);
    const otherSet = new Set(otherKeys);
    return [
      ...backfill(
        rows,
        union.filter((k) => !currentSet.has(k)),
      ),
      ...backfill(
        other,
        union.filter((k) => !otherSet.has(k)),
      ),
    ];
  },
};

// --- lookup ------------------------------------------------------------------------------------------

interface LookupConfig {
  secondary: SecondaryInput;
  sourceKey: string;
  lookupKey: string;
  columns: string[];
}

export const lookupHandler: StepHandler<LookupConfig> = {
  stepClass: "client*",
  decode(raw) {
    const obj = asObject(raw);
    return {
      secondary: decodeSecondaryInput(obj, "referenceDataSourceId"),
      sourceKey: str(obj, "sourceKey", ""),
      lookupKey: str(obj, "lookupKey", ""),
      columns: stringArray(obj, "columns"),
    };
  },
  problems: (c) =>
    missingRequired("lookup", [
      ["sourceKey", c.sourceKey],
      ["lookupKey", c.lookupKey],
    ]),
  declines: (c, ctx) => declineSecondary(c.secondary, ctx),
  apply(rows, { secondary, sourceKey, lookupKey, columns }, ctx) {
    const distinct = [...new Set(columns)];
    const mapping = resolveColumnNames(
      allKeys(rows),
      distinct,
      sourceKey === lookupKey ? lookupKey : undefined,
    );
    const outputs = distinct.filter((c) => mapping.has(c));
    const ref = secondaryRows(secondary, ctx, "lookup");
    const { keys, index } = indexByKey(ref, lookupKey);
    return rows.map((leftRow) => {
      const out: Record<string, Value> = { ...leftRow };
      const match = index.get(keys.scalar(cell(leftRow, sourceKey)))?.[0];
      for (const c of outputs) put(out, mapping.get(c)!, match ? cell(match, c) : null);
      return out;
    });
  },
};

/** `laneDependencyOf`: the lane step a join/union/lookup reads, or `undefined` (also for an undecodable config). */
export function laneDependencyOf(kind: string, config: unknown): string | undefined {
  const handler =
    kind === "join"
      ? joinHandler
      : kind === "union"
        ? unionHandler
        : kind === "lookup"
          ? lookupHandler
          : undefined;
  if (!handler) return undefined;
  try {
    const decoded = handler.decode(config) as { secondary: SecondaryInput };
    return decoded.secondary.kind === "lane" ? decoded.secondary.stepId : undefined;
  } catch {
    return undefined;
  }
}
