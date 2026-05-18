// PipelineDetailPage state helpers — op-type catalog, default config seeds,
// step factories, and per-kind narrowing functions.
//
// Extracted from `../ui/PipelineDetailPage.tsx` as part of CS3 cycle 2.
// Behavior-preserving: every helper here is a verbatim move from the
// original file; consumers import them by name.

import {
  faArrowsUpDown,
  faArrowUp,
  faCalculator,
  faChartColumn,
  faFilter,
  faLink,
  faPencil,
  faRightLeft,
  faSquareCheck,
} from "@fortawesome/free-solid-svg-icons";

import type {
  AggregateConfig as AggregateConfigType,
  CastConfig as CastConfigType,
  ComputeConfig as ComputeConfigType,
  FilterConfig as FilterConfigType,
  LimitConfig as LimitConfigType,
  PipelineStep,
  PipelineStepConfig,
  RenameConfig as RenameConfigType,
  SelectConfig as SelectConfigType,
  SortConfig as SortConfigType,
} from "../types/pipelineStep";
import type { OpType, Step } from "../types/step";
import type { AggregateConfigValue } from "../ui/AggregateConfig";
import type { ComputeConfigValue } from "../ui/ComputeFieldConfig";
import type { FilterConfigValue } from "../ui/FilterConfig";
import type { SortKey } from "../ui/SortConfig";

// OP_TYPES drives the picker dropdown — join is intentionally excluded until
// full join semantics ship (re-expose when HEL-278 is resolved and the
// backend implementation is complete).
export const OP_TYPES: OpType[] = [
  { id: "select", label: "Select fields", icon: faSquareCheck },
  { id: "rename", label: "Rename column", icon: faPencil },
  { id: "filter", label: "Filter rows", icon: faFilter },
  { id: "compute", label: "Compute column", icon: faCalculator },
  { id: "aggregate", label: "Group & aggregate", icon: faChartColumn },
  { id: "cast", label: "Cast type", icon: faRightLeft },
  { id: "limit", label: "Limit rows", icon: faArrowUp },
  { id: "sort", label: "Sort rows", icon: faArrowsUpDown },
];

// Internal lookup entry for join — kept out of OP_TYPES (picker) but needed
// so pipelineStepToStep can resolve existing backend-loaded join steps without
// falling back to the wrong op type.
const JOIN_OP_TYPE: OpType = { id: "join", label: "Join tables", icon: faLink };

/** Empty / default config per kind. Matches the seed shapes used in the
 *  `handleAddStep` flow — kept as a single source of truth so seeding new
 *  steps and parsing the absence of persisted config (legacy in-flight steps
 *  with no body) produce the same shape. */
export function defaultConfigFor(kind: string): PipelineStepConfig {
  switch (kind) {
    case "select":
      return { fields: [] } as SelectConfigType;
    case "rename":
      return { renames: {} } as RenameConfigType;
    case "cast":
      return { casts: {} } as CastConfigType;
    case "filter":
      return { combinator: "AND", conditions: [] } as FilterConfigType;
    case "compute":
      return { column: "", expression: "", type: "number" } as ComputeConfigType;
    case "aggregate":
      return { groupBy: [], aggregations: [] } as AggregateConfigType;
    case "limit":
      return { count: 100 } as LimitConfigType;
    case "sort":
      return { sortBy: [] } as SortConfigType;
    case "join":
      return { rightDataSourceId: "", joinKey: "", joinType: "inner" };
    case "groupby":
      return { groupBy: [], aggColumn: "", aggFunction: "sum" };
    default:
      return { fields: [] } as SelectConfigType;
  }
}

let stepCounter = 0;
export function makeStep(opType: OpType): Step {
  stepCounter += 1;
  return {
    id: `step-${stepCounter}`,
    opType,
    label: opType.label,
    config: defaultConfigFor(opType.id),
  };
}

export function pipelineStepToStep(ps: PipelineStep): Step {
  // Join is excluded from the picker (OP_TYPES) but must still resolve
  // correctly when a backend-loaded step has type "join".
  const opType =
    ps.type === "join" ? JOIN_OP_TYPE : (OP_TYPES.find((op) => op.id === ps.type) ?? OP_TYPES[0]);
  return {
    id: ps.id,
    opType,
    label: opType.label,
    config: ps.config,
  };
}

// ── Narrowing helpers ────────────────────────────────────────────────────────
//
// CS2c-3a: configs are already typed objects (the wire shape is a
// discriminated union). These helpers narrow `Step.config` to the kind-specific
// shape — no JSON.parse needed.

export function selectedFieldsOf(step: Step): string[] {
  return step.opType.id === "select" ? (step.config as SelectConfigType).fields : [];
}

export function renamesOf(step: Step): Record<string, string> {
  return step.opType.id === "rename" ? (step.config as RenameConfigType).renames : {};
}

export function castsOf(step: Step): Record<string, string> {
  return step.opType.id === "cast" ? (step.config as CastConfigType).casts : {};
}

export function filterConfigOf(step: Step): FilterConfigValue {
  if (step.opType.id !== "filter") return { combinator: "AND", conditions: [] };
  const cfg = step.config as FilterConfigType;
  return {
    combinator: cfg.combinator === "OR" ? "OR" : "AND",
    conditions: (cfg.conditions ?? []) as FilterConfigValue["conditions"],
  };
}

export function computeConfigOf(step: Step): ComputeConfigValue {
  const empty: ComputeConfigValue = { column: "", expression: "", type: "number" };
  if (step.opType.id !== "compute") return empty;
  const cfg = step.config as ComputeConfigType;
  return {
    column: cfg.column ?? "",
    expression: cfg.expression ?? "",
    type: cfg.type ?? "number",
  };
}

export function limitCountOf(step: Step): number {
  if (step.opType.id !== "limit") return 100;
  const cfg = step.config as LimitConfigType;
  return typeof cfg.count === "number" && cfg.count > 0 ? cfg.count : 100;
}

export function aggregateConfigOf(step: Step): AggregateConfigValue {
  if (step.opType.id !== "aggregate") return { groupBy: [], aggregations: [] };
  const cfg = step.config as AggregateConfigType;
  return {
    groupBy: cfg.groupBy as AggregateConfigValue["groupBy"],
    aggregations: cfg.aggregations as AggregateConfigValue["aggregations"],
  };
}

export function sortConfigOf(step: Step): SortKey[] {
  if (step.opType.id !== "sort") return [];
  const cfg = step.config as SortConfigType;
  return Array.isArray(cfg.sortBy) ? (cfg.sortBy as SortKey[]) : [];
}
