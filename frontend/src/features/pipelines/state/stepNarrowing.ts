// PipelineDetailPage state helpers — op-type catalog, default config seeds,
// step factories, and per-kind narrowing functions.
//
// Extracted from `../ui/PipelineDetailPage.tsx` as part of CS3 cycle 2.
// Behavior-preserving: every helper here is a verbatim move from the
// original file; consumers import them by name.

import {
  faAlignLeft,
  faArrowsUpDown,
  faArrowUp,
  faCalculator,
  faCalendarWeek,
  faChartColumn,
  faClipboardCheck,
  faClone,
  faFilter,
  faFillDrip,
  faFont,
  faHeading,
  faLayerGroup,
  faLink,
  faObjectGroup,
  faPencil,
  faRankingStar,
  faRightLeft,
  faSquareCheck,
  faTableCells,
  faTableList,
  faTags,
} from "@fortawesome/free-solid-svg-icons";

import type {
  AggregateConfig as AggregateConfigType,
  AssertConfig as AssertConfigType,
  CastConfig as CastConfigType,
  ChunkByTokenCountConfig as ChunkByTokenCountConfigType,
  ComputeConfig as ComputeConfigType,
  DateBucketConfig as DateBucketConfigType,
  DedupeConfig as DedupeConfigType,
  ExtractHeadingsConfig as ExtractHeadingsConfigType,
  FillNullConfig as FillNullConfigType,
  FilterConfig as FilterConfigType,
  LimitConfig as LimitConfigType,
  LookupConfig as LookupConfigType,
  PipelineStep,
  PipelineStepConfig,
  PivotConfig as PivotConfigType,
  RenameConfig as RenameConfigType,
  SelectConfig as SelectConfigType,
  SortConfig as SortConfigType,
  SplitTextConfig as SplitTextConfigType,
  StringOpsConfig as StringOpsConfigType,
  UnionConfig as UnionConfigType,
  UnpivotConfig as UnpivotConfigType,
  WindowConfig as WindowConfigType,
} from "../types/pipelineStep";
import type { OpType, Step } from "../types/step";
import type { AggregateConfigValue } from "../ui/stepConfigs/AggregateConfig";
import type { AssertConfigValue } from "../ui/stepConfigs/AssertConfig";
import type { ChunkByTokenCountConfigValue } from "../ui/stepConfigs/ChunkByTokenCountConfig";
import type { ComputeConfigValue } from "../ui/stepConfigs/ComputeFieldConfig";
import {
  DATE_BUCKET_GRANULARITIES,
  type DateBucketConfigValue,
} from "../ui/stepConfigs/DateBucketConfig";
import type { DedupeConfigValue } from "../ui/stepConfigs/DedupeConfig";
import type { ExtractHeadingsConfigValue } from "../ui/stepConfigs/ExtractHeadingsConfig";
import { FILL_NULL_STRATEGIES, type FillNullConfigValue } from "../ui/stepConfigs/FillNullConfig";
import type { FilterConfigValue } from "../ui/stepConfigs/FilterConfig";
import type { LookupConfigValue } from "../ui/stepConfigs/LookupConfig";
import { PIVOT_AGG_FNS, type PivotConfigValue } from "../ui/stepConfigs/PivotConfig";
import type { SortKey } from "../ui/stepConfigs/SortConfig";
import type { SplitTextConfigValue } from "../ui/stepConfigs/SplitTextConfig";
import {
  STRING_OPS_OPERATIONS,
  type StringOpsConfigValue,
} from "../ui/stepConfigs/StringOpsConfig";
import type { UnionConfigValue } from "../ui/stepConfigs/UnionConfig";
import type { UnpivotConfigValue } from "../ui/stepConfigs/UnpivotConfig";
import { WINDOW_FUNCTIONS, type WindowConfigValue } from "../ui/stepConfigs/WindowConfig";

// OP_TYPES drives the picker dropdown — join is intentionally excluded: no
// `JoinConfig.tsx` editor exists (HEL-264's original rationale — showing an
// unconfigurable op led to confusion), not the now-resolved HEL-278 ACL gap.
// `union` (HEL-384) is the async/repo-touching sibling of join, but ships
// both a full editor (UnionConfig.tsx) and its own ACL check (design.md
// Decision 9), so it does NOT mirror join's exclusion — see design.md
// Decision 7.
// `lookup` (HEL-386) is the third async/repo-touching op — like `union`, it
// ships both a full editor (LookupConfig.tsx) and its own ACL check
// (design.md Decision 9 there / Decision 9 here), so it also does NOT
// mirror join's exclusion.
// `assert` (HEL-454 / 419-A) is purely local (no second-DataSource reference,
// no ACL pre-flight) — a pass-through step like `filter`/`limit`/`sort`, so
// it ships a full editor (AssertConfig.tsx) with no ACL-check counterpart.
export const OP_TYPES: OpType[] = [
  { id: "select", label: "Select fields", icon: faSquareCheck },
  { id: "rename", label: "Rename column", icon: faPencil },
  { id: "filter", label: "Filter rows", icon: faFilter },
  { id: "compute", label: "Compute column", icon: faCalculator },
  { id: "aggregate", label: "Group & aggregate", icon: faChartColumn },
  { id: "cast", label: "Cast type", icon: faRightLeft },
  { id: "limit", label: "Limit rows", icon: faArrowUp },
  { id: "sort", label: "Sort rows", icon: faArrowsUpDown },
  { id: "splittext", label: "Split text", icon: faAlignLeft },
  { id: "extractheadings", label: "Extract headings", icon: faHeading },
  { id: "chunkbytokencount", label: "Chunk by token count", icon: faLayerGroup },
  { id: "datebucket", label: "Date bucket", icon: faCalendarWeek },
  { id: "pivot", label: "Pivot (long → wide)", icon: faTableCells },
  { id: "window", label: "Window (rank / running total)", icon: faRankingStar },
  { id: "unpivot", label: "Unpivot (wide → long)", icon: faTableList },
  { id: "dedupe", label: "Dedupe rows", icon: faClone },
  { id: "fillnull", label: "Fill null / impute", icon: faFillDrip },
  { id: "stringops", label: "String operation", icon: faFont },
  { id: "union", label: "Union / append rows", icon: faObjectGroup },
  { id: "lookup", label: "Lookup / enrich", icon: faTags },
  { id: "assert", label: "Assert / validate", icon: faClipboardCheck },
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
    case "splittext":
      return {
        field: "",
        mode: "paragraph",
        headingLevel: 1,
        indexField: "segmentIndex",
      } as SplitTextConfigType;
    case "extractheadings":
      return {
        field: "",
        indexField: "headingIndex",
        levelField: "headingLevel",
      } as ExtractHeadingsConfigType;
    case "chunkbytokencount":
      return {
        field: "",
        targetTokenCount: 500,
        encoding: "o200k_base",
        indexField: "chunkIndex",
        tokenCountField: "tokenCount",
      } as ChunkByTokenCountConfigType;
    case "datebucket":
      return { field: "", granularity: "day" } as DateBucketConfigType;
    case "pivot":
      return { index: [], column: "", values: "", agg: "sum" } as PivotConfigType;
    case "window":
      return {
        partitionBy: [],
        orderBy: [],
        function: "row_number",
        outputColumn: "",
      } as WindowConfigType;
    case "unpivot":
      return {
        idVars: [],
        valueVars: [],
        varName: "variable",
        valueName: "value",
      } as UnpivotConfigType;
    case "dedupe":
      return { keys: [], keep: "first" } as DedupeConfigType;
    case "fillnull":
      return { columns: [], strategy: "constant", value: null } as FillNullConfigType;
    case "stringops":
      return {
        operation: "trim",
        field: "",
        outputColumn: "",
        pattern: null,
        separator: null,
        index: null,
        fields: null,
      } as StringOpsConfigType;
    case "union":
      return { otherDataSourceId: "", mode: "byPosition" } as UnionConfigType;
    case "lookup":
      return {
        referenceDataSourceId: "",
        sourceKey: "",
        lookupKey: "",
        columns: [],
      } as LookupConfigType;
    case "assert":
      return { rules: [] } as AssertConfigType;
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
    // A freshly created (not-yet-persisted) step is always enabled — there's
    // no UI affordance to create a disabled step directly.
    enabled: true,
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
    // HEL-412: normalize-at-boundary default, mirroring
    // `pipelineService.ts`'s `enabled ?? true` (belt-and-suspenders — this
    // helper is also called with the raw response of create/duplicate calls
    // that don't route through a dedicated normalizer).
    enabled: ps.enabled ?? true,
  };
}

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

export function splitTextConfigOf(step: Step): SplitTextConfigValue {
  const empty: SplitTextConfigValue = {
    field: "",
    mode: "paragraph",
    headingLevel: 1,
    indexField: "segmentIndex",
  };
  if (step.opType.id !== "splittext") return empty;
  const cfg = step.config as SplitTextConfigType;
  return {
    field: cfg.field ?? "",
    mode: cfg.mode === "heading" ? "heading" : "paragraph",
    headingLevel:
      typeof cfg.headingLevel === "number" && cfg.headingLevel > 0 ? cfg.headingLevel : 1,
    indexField: cfg.indexField ?? "segmentIndex",
  };
}

export function extractHeadingsConfigOf(step: Step): ExtractHeadingsConfigValue {
  const empty: ExtractHeadingsConfigValue = {
    field: "",
    indexField: "headingIndex",
    levelField: "headingLevel",
  };
  if (step.opType.id !== "extractheadings") return empty;
  const cfg = step.config as ExtractHeadingsConfigType;
  return {
    field: cfg.field ?? "",
    indexField: cfg.indexField ?? "headingIndex",
    levelField: cfg.levelField ?? "headingLevel",
  };
}

export function chunkByTokenCountConfigOf(step: Step): ChunkByTokenCountConfigValue {
  const empty: ChunkByTokenCountConfigValue = {
    field: "",
    targetTokenCount: 500,
    encoding: "o200k_base",
    indexField: "chunkIndex",
    tokenCountField: "tokenCount",
  };
  if (step.opType.id !== "chunkbytokencount") return empty;
  const cfg = step.config as ChunkByTokenCountConfigType;
  return {
    field: cfg.field ?? "",
    targetTokenCount:
      typeof cfg.targetTokenCount === "number" && cfg.targetTokenCount > 0
        ? cfg.targetTokenCount
        : 500,
    encoding: cfg.encoding === "cl100k_base" ? "cl100k_base" : "o200k_base",
    indexField: cfg.indexField ?? "chunkIndex",
    tokenCountField: cfg.tokenCountField ?? "tokenCount",
  };
}

export function dateBucketConfigOf(step: Step): DateBucketConfigValue {
  const empty: DateBucketConfigValue = { field: "", granularity: "day", outputColumn: "" };
  if (step.opType.id !== "datebucket") return empty;
  const cfg = step.config as DateBucketConfigType;
  const granularity = (DATE_BUCKET_GRANULARITIES as readonly string[]).includes(cfg.granularity)
    ? cfg.granularity
    : "day";
  return {
    field: cfg.field ?? "",
    granularity,
    outputColumn: cfg.outputColumn ?? "",
  };
}

export function pivotConfigOf(step: Step): PivotConfigValue {
  const empty: PivotConfigValue = { index: [], column: "", values: "", agg: "sum" };
  if (step.opType.id !== "pivot") return empty;
  const cfg = step.config as PivotConfigType;
  const agg = (PIVOT_AGG_FNS as readonly string[]).includes(cfg.agg) ? cfg.agg : "sum";
  return {
    index: Array.isArray(cfg.index) ? cfg.index : [],
    column: cfg.column ?? "",
    values: cfg.values ?? "",
    agg,
  };
}

export function unpivotConfigOf(step: Step): UnpivotConfigValue {
  const empty: UnpivotConfigValue = {
    idVars: [],
    valueVars: [],
    varName: "variable",
    valueName: "value",
  };
  if (step.opType.id !== "unpivot") return empty;
  const cfg = step.config as UnpivotConfigType;
  return {
    idVars: Array.isArray(cfg.idVars) ? cfg.idVars : [],
    valueVars: Array.isArray(cfg.valueVars) ? cfg.valueVars : [],
    varName: cfg.varName ?? "variable",
    valueName: cfg.valueName ?? "value",
  };
}

export function dedupeConfigOf(step: Step): DedupeConfigValue {
  const empty: DedupeConfigValue = { keys: [], keep: "first" };
  if (step.opType.id !== "dedupe") return empty;
  const cfg = step.config as DedupeConfigType;
  return {
    keys: Array.isArray(cfg.keys) ? cfg.keys : [],
    keep: cfg.keep === "last" ? "last" : "first",
  };
}

export function fillNullConfigOf(step: Step): FillNullConfigValue {
  const empty: FillNullConfigValue = { columns: [], strategy: "constant", value: null };
  if (step.opType.id !== "fillnull") return empty;
  const cfg = step.config as FillNullConfigType;
  const strategy = (FILL_NULL_STRATEGIES as readonly string[]).includes(cfg.strategy)
    ? cfg.strategy
    : "constant";
  return {
    columns: Array.isArray(cfg.columns) ? cfg.columns : [],
    strategy,
    value: cfg.value ?? null,
  };
}

export function stringOpsConfigOf(step: Step): StringOpsConfigValue {
  const empty: StringOpsConfigValue = {
    operation: "trim",
    field: "",
    outputColumn: "",
    pattern: "",
    separator: "",
    index: 0,
    fields: [],
  };
  if (step.opType.id !== "stringops") return empty;
  const cfg = step.config as StringOpsConfigType;
  const operation = (STRING_OPS_OPERATIONS as readonly string[]).includes(cfg.operation)
    ? cfg.operation
    : "trim";
  return {
    operation,
    field: cfg.field ?? "",
    outputColumn: cfg.outputColumn ?? "",
    pattern: cfg.pattern ?? "",
    separator: cfg.separator ?? "",
    index: typeof cfg.index === "number" ? cfg.index : 0,
    fields: Array.isArray(cfg.fields) ? cfg.fields : [],
  };
}

export function windowConfigOf(step: Step): WindowConfigValue {
  const empty: WindowConfigValue = {
    partitionBy: [],
    orderBy: [],
    function: "row_number",
    field: "",
    outputColumn: "",
    offset: 1,
  };
  if (step.opType.id !== "window") return empty;
  const cfg = step.config as WindowConfigType;
  const fn = (WINDOW_FUNCTIONS as readonly string[]).includes(cfg.function)
    ? cfg.function
    : "row_number";
  return {
    partitionBy: Array.isArray(cfg.partitionBy) ? cfg.partitionBy : [],
    orderBy: Array.isArray(cfg.orderBy) ? (cfg.orderBy as SortKey[]) : [],
    function: fn,
    field: cfg.field ?? "",
    outputColumn: cfg.outputColumn ?? "",
    offset: typeof cfg.offset === "number" && cfg.offset > 0 ? cfg.offset : 1,
  };
}

export function unionConfigOf(step: Step): UnionConfigValue {
  const empty: UnionConfigValue = { otherDataSourceId: "", mode: "byPosition" };
  if (step.opType.id !== "union") return empty;
  const cfg = step.config as UnionConfigType;
  return {
    otherDataSourceId: cfg.otherDataSourceId ?? "",
    mode: cfg.mode === "byName" ? "byName" : "byPosition",
  };
}

export function lookupConfigOf(step: Step): LookupConfigValue {
  const empty: LookupConfigValue = {
    referenceDataSourceId: "",
    sourceKey: "",
    lookupKey: "",
    columns: [],
  };
  if (step.opType.id !== "lookup") return empty;
  const cfg = step.config as LookupConfigType;
  return {
    referenceDataSourceId: cfg.referenceDataSourceId ?? "",
    sourceKey: cfg.sourceKey ?? "",
    lookupKey: cfg.lookupKey ?? "",
    columns: Array.isArray(cfg.columns) ? cfg.columns : [],
  };
}

export function assertConfigOf(step: Step): AssertConfigValue {
  const empty: AssertConfigValue = { rules: [] };
  if (step.opType.id !== "assert") return empty;
  const cfg = step.config as AssertConfigType;
  return {
    rules: Array.isArray(cfg.rules)
      ? cfg.rules.map((r) => ({
          kind: r.kind ?? "",
          field: r.field ?? "",
          params: r.params ?? {},
          severity: r.severity ?? "warn",
        }))
      : [],
  };
}
