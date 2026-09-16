// PipelineDetailPage state helpers — op-type catalog, default config seeds,
// step factories, and per-kind narrowing functions.
//
// Extracted from `../ui/PipelineDetailPage.tsx` as part of CS3 cycle 2.
// Behavior-preserving: every helper here is a verbatim move from the
// original file; consumers import them by name.

import type {
  AggregateConfig as AggregateConfigType,
  AnalyzeWithAiConfig as AnalyzeWithAiConfigType,
  AssertConfig as AssertConfigType,
  CastConfig as CastConfigType,
  ChunkByTokenCountConfig as ChunkByTokenCountConfigType,
  ComputeConfig as ComputeConfigType,
  ConvertFormatConfig as ConvertFormatConfigType,
  ConvertFormatFrom,
  ConvertFormatTo,
  DateBucketConfig as DateBucketConfigType,
  DedupeConfig as DedupeConfigType,
  ExtractHeadingsConfig as ExtractHeadingsConfigType,
  FillNullConfig as FillNullConfigType,
  FilterConfig as FilterConfigType,
  GenerateTextConfig as GenerateTextConfigType,
  LimitConfig as LimitConfigType,
  LookupConfig as LookupConfigType,
  OutputSchemaField,
  OutputSchemaFieldType,
  PipelineStep,
  PipelineStepConfig,
  PivotConfig as PivotConfigType,
  RenameConfig as RenameConfigType,
  SchemaField,
  SecondaryInput,
  SelectConfig as SelectConfigType,
  SortConfig as SortConfigType,
  SplitTextConfig as SplitTextConfigType,
  StringOpsConfig as StringOpsConfigType,
  UnionConfig as UnionConfigType,
  UnpivotConfig as UnpivotConfigType,
  UpsertSourceConfig as UpsertSourceConfigType,
  UpsertTarget,
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
import type { UpsertSourceConfigValue } from "../ui/stepConfigs/UpsertSourceConfig";
import { WINDOW_FUNCTIONS, type WindowConfigValue } from "../ui/stepConfigs/WindowConfig";
import {
  TextAlignStart,
  ArrowLeftRight,
  ArrowUp,
  ArrowUpDown,
  Award,
  ChartColumn,
  Calculator,
  CalendarDays,
  SquareCheckBig,
  ClipboardCheck,
  Files,
  Funnel,
  Group,
  Heading,
  HelpCircle,
  Layers,
  Link2,
  List,
  PaintBucket,
  PenLine,
  Pencil,
  Repeat2,
  Save,
  Sparkles,
  Table2,
  Tags,
  Type,
} from "lucide-react";

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
  { id: "select", label: "Select fields", icon: SquareCheckBig },
  { id: "rename", label: "Rename column", icon: Pencil },
  { id: "filter", label: "Filter rows", icon: Funnel },
  { id: "compute", label: "Compute column", icon: Calculator },
  { id: "aggregate", label: "Group & aggregate", icon: ChartColumn },
  { id: "cast", label: "Cast type", icon: ArrowLeftRight },
  { id: "limit", label: "Limit rows", icon: ArrowUp },
  { id: "sort", label: "Sort rows", icon: ArrowUpDown },
  { id: "splittext", label: "Split text", icon: TextAlignStart },
  { id: "extractheadings", label: "Extract headings", icon: Heading },
  { id: "chunkbytokencount", label: "Chunk by token count", icon: Layers },
  { id: "datebucket", label: "Date bucket", icon: CalendarDays },
  { id: "pivot", label: "Pivot (long → wide)", icon: Table2 },
  { id: "window", label: "Window (rank / running total)", icon: Award },
  { id: "unpivot", label: "Unpivot (wide → long)", icon: List },
  { id: "dedupe", label: "Dedupe rows", icon: Files },
  { id: "fillnull", label: "Fill null / impute", icon: PaintBucket },
  { id: "stringops", label: "String operation", icon: Type },
  { id: "union", label: "Union / append rows", icon: Group },
  { id: "lookup", label: "Lookup / enrich", icon: Tags },
  { id: "assert", label: "Assert / validate", icon: ClipboardCheck },
  // `upsertsource` (HEL-1102) is the fourth async/repo-touching op -- like
  // `union`/`lookup`, it ships a full editor (UpsertSourceConfig.tsx) and
  // its own ownership check (design.md Decision 2), so it also does NOT
  // mirror join's exclusion.
  { id: "upsertsource", label: "Write to source", icon: Save },
  // HEL-1109 (design.md D1) — three ops, three OP_TYPES entries, no group
  // field: HEL-1136 moves grouping to a backend-owned field.
  { id: "convertformat", label: "Convert format", icon: Repeat2 },
  { id: "analyzewithai", label: "Analyze with AI", icon: Sparkles },
  { id: "generatetext", label: "Generate text", icon: PenLine },
];

// design.md D2/D3 — the four supported `from`/`to` pairs, the ONLY pairs the
// card's Select can produce. Mirrors the backend's `SupportedPairs`
// (`ConvertFormatConfig.scala`).
export const SUPPORTED_CONVERT_FORMAT_PAIRS: readonly [ConvertFormatFrom, ConvertFormatTo][] = [
  ["csv", "json"],
  ["json", "csv"],
  ["text", "markdown"],
  ["markdown", "text"],
];

/** design.md D4 — the four model-producible output-schema field types, the
 *  only types `AnalyzeWithAiConfig`'s row editor can offer (the backend
 *  rejects anything else with a named 422). */
export const OUTPUT_SCHEMA_FIELD_TYPES: readonly OutputSchemaFieldType[] = [
  "string",
  "integer",
  "float",
  "boolean",
];

/** design.md D3 — matches `AnalyzeWithAiConfig.scala:30`. */
export const MAX_OUTPUT_SCHEMA_ENTRIES = 50;

// HEL-1108: AI steps are never auto-runnable and draw on a shared daily
// budget -- the two kinds whose card carries the cost/quota disclosure
// (design.md D5, pipeline-ai-step-authoring spec).
const AI_STEP_KINDS = new Set(["analyzewithai", "generatetext"]);

/** design.md D3 — true for a step kind whose write-path validator rejects an
 *  incomplete config (today `analyzewithai`/`generatetext`, both delegating
 *  to an all-fields-required `validate`). Derived here, in ONE place, so no
 *  call site needs its own op-name check -- the 22 other ops (and
 *  `convertformat`, whose seed tolerates an absent `from`/`to`) keep
 *  create-immediately behavior unchanged. */
export function requiresCompleteConfigForCreate(kind: string): boolean {
  return AI_STEP_KINDS.has(kind);
}

/** design.md D5 / pipeline-ai-step-authoring spec — true for a step kind
 *  whose card carries the per-row-cost/no-auto-run/shared-quota disclosure.
 *  Currently identical to [[requiresCompleteConfigForCreate]]'s set, but kept
 *  as its own named predicate since the two concerns (deferred-create vs.
 *  cost disclosure) are independent contracts that happen to share a set of
 *  kinds today, not the same rule. */
export function isAiStepKind(kind: string): boolean {
  return AI_STEP_KINDS.has(kind);
}

/** design.md D3 — the local completeness predicate mirrors the backend's own
 *  `AnalyzeWithAiConfig.validate`/`GenerateTextConfig.validate` field-for-
 *  field: non-empty (post-trim) `inputField`/`instruction`/`outputField`,
 *  1..`MAX_OUTPUT_SCHEMA_ENTRIES` declared entries for `analyzewithai`, each
 *  declared name non-empty/unique/not colliding with `inputField`, and each
 *  declared type one of `OUTPUT_SCHEMA_FIELD_TYPES`. A narrower predicate
 *  would fire a create that the backend 422s; a wider one means the step
 *  never saves. Non-AI kinds are always considered complete (this predicate
 *  is never consulted for them via `requiresCompleteConfigForCreate`). */
export function isCompleteAiStepConfig(kind: string, config: PipelineStepConfig): boolean {
  if (kind === "analyzewithai") {
    const cfg = config as AnalyzeWithAiConfigType;
    if (!cfg.inputField?.trim() || !cfg.instruction?.trim()) return false;
    const schema = cfg.outputSchema ?? [];
    if (schema.length < 1 || schema.length > MAX_OUTPUT_SCHEMA_ENTRIES) return false;
    const seenNames = new Set<string>();
    for (const field of schema) {
      const name = field.name?.trim();
      if (!name) return false;
      if (name === cfg.inputField.trim()) return false;
      if (seenNames.has(name)) return false;
      seenNames.add(name);
      if (!(OUTPUT_SCHEMA_FIELD_TYPES as readonly string[]).includes(field.type)) return false;
    }
    return true;
  }
  if (kind === "generatetext") {
    const cfg = config as GenerateTextConfigType;
    return Boolean(cfg.inputField?.trim() && cfg.instruction?.trim() && cfg.outputField?.trim());
  }
  return true;
}

// Internal lookup entry for join — kept out of OP_TYPES (picker) but needed
// so pipelineStepToStep can resolve existing backend-loaded join steps without
// falling back to the wrong op type.
const JOIN_OP_TYPE: OpType = { id: "join", label: "Join tables", icon: Link2 };

// HEL-1100 (design.md Decision 9): a step kind the frontend does not (yet) recognize -- e.g. a
// persisted `upsertsource` step before HEL-1102's real step card ships. `pipelineStepToStep`
// falls back to this rather than `OP_TYPES[0]` ("Select fields"), which used to silently
// mis-render an unknown op as a Select step. `id` is namespaced `unsupported:<type>` so it can
// never collide with a real, registered `OpType.id`.
export function unsupportedOpType(type: string): OpType {
  return { id: `unsupported:${type}`, label: `Unsupported step (${type})`, icon: HelpCircle };
}

/** HEL-1100 (design.md Decision 9): true for an `OpType` produced by [[unsupportedOpType]] --
 *  used by `StepOpEditor` (renders a read-only notice instead of any config editor) and
 *  `useStepCardState.persist` (skips `updatePipelineStep` entirely for an unsupported step,
 *  since there is no config editor that could have produced a real edit to save). */
export function isUnsupportedOpType(opType: OpType): boolean {
  return opType.id.startsWith("unsupported:");
}

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
      return {
        secondaryInput: { kind: "source", dataSourceId: "" },
        joinKey: "",
        joinType: "inner",
      };
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
      return {
        secondaryInput: { kind: "source", dataSourceId: "" },
        mode: "byPosition",
      } as UnionConfigType;
    case "lookup":
      return {
        secondaryInput: { kind: "source", dataSourceId: "" },
        sourceKey: "",
        lookupKey: "",
        columns: [],
      } as LookupConfigType;
    case "assert":
      return { rules: [] } as AssertConfigType;
    case "upsertsource":
      // design.md Decision 3/4: `target` is deliberately ABSENT (no synthesized default --
      // HEL-386/620 precedent), `mode` is explicitly seeded to "append" (the toggle's own
      // visible initial selection, matching the backend's own absent-`mode` decode default).
      return { mode: "append" } as UpsertSourceConfigType;
    case "convertformat":
      // design.md D3 -- `from`/`to` are DELIBERATELY ABSENT, not seeded `""`
      // like every sibling string field: a present-and-empty pair is
      // rejected 422 by the backend's `pairError`, while an absent pair
      // passes. This is the load-bearing seed the whole trap this ticket
      // exists to avoid turns on.
      return { field: "" } as ConvertFormatConfigType;
    case "analyzewithai":
      // No honest complete seed exists (design.md D3) -- this kind defers
      // its create until the card's own local state satisfies
      // `isCompleteAiStepConfig`, so this shape is only ever read by the
      // card's own initial local state, never POSTed as-is.
      return { inputField: "", instruction: "", outputSchema: [] } as AnalyzeWithAiConfigType;
    case "generatetext":
      // Same deferred-create rationale as `analyzewithai` above.
      return { inputField: "", instruction: "", outputField: "" } as GenerateTextConfigType;
    default:
      return { fields: [] } as SelectConfigType;
  }
}

let stepCounter = 0;
/** `parentStepId`, when passed (HEL-908 task 3.4's "+ tail" affordance),
 *  marks this temp step as a tail attach — purely cosmetic until the create
 *  call resolves and the page refetches the authoritative list; the trunk
 *  append path (no `parentStepId`) is unaffected. */
export function makeStep(opType: OpType, parentStepId?: string): Step {
  stepCounter += 1;
  return {
    id: `step-${stepCounter}`,
    opType,
    label: opType.label,
    config: defaultConfigFor(opType.id),
    // A freshly created (not-yet-persisted) step is always enabled — there's
    // no UI affordance to create a disabled step directly.
    enabled: true,
    parentStepId,
  };
}

/** HEL-1109 (evaluation-1.md CR3) — single source of truth for "is this id a
 *  not-yet-persisted local step", matching exactly the `step-<counter>` shape
 *  [[makeStep]] mints above. The invariant belongs to `makeStep`'s minting
 *  format, not to each call site re-deriving it: a real backend id is a UUID
 *  and can never collide with this shape, but several pre-existing call
 *  sites (`usePipelineDetailPage.ts`) used a looser `startsWith("step-")`
 *  check that also (harmlessly, in production) matches a semantic id like
 *  `"upsertsource-1"`'s prefix-adjacent cousins — exported here so every
 *  site, old and new, derives the same answer from one place rather than
 *  each guessing its own regex. */
export function isTempStepId(id: string): boolean {
  return /^step-\d+$/.test(id);
}

/** Minimal shape `resolveDraftFallbackSchema` needs from an analyze-derived
 *  per-step entry -- deliberately narrower than `usePipelineDetailPage.ts`'s
 *  own internal map-entry type, so this function stays independent of that
 *  hook's private types. */
export interface DraftFallbackAnalyzeEntry {
  outputSchema: SchemaField[];
}

/** HEL-1109 (design.md Risks; pipeline-ai-step-authoring spec "A draft's
 *  field picker falls back to its own anchor's schema") — a draft AI step
 *  is never sent to `/analyze` (design.md D3/D6), so it has no analyze entry
 *  of its own; without a fallback its field pickers would show zero options
 *  until it were already complete, which is exactly the field it needs a
 *  picker to fill.
 *
 *  evaluation-1.md CR2(a) — a LANE draft (`meta.parentStepId` set, from
 *  `handleAddLaneStep`) resolves from that EXACT anchor's own output schema,
 *  never a flat trunk-order walk: the anchor is known precisely (the step
 *  the "+ lane" affordance was clicked on), so guessing via array position
 *  could offer fields from an unrelated trunk step and let the draft
 *  complete a config referencing a field its real input never has. A TRUNK
 *  draft (no `parentStepId` — `handleInsertStep`) keeps the backward walk
 *  over the local `steps` array to the nearest PRECEDING step with a real
 *  analyze entry, using that step's own output schema.
 *
 *  Either path's ultimate fallback (no anchor entry found at all — the
 *  draft is the pipeline's first-ever step, or its parent/nearest
 *  predecessor is itself still a draft) is the OWNING root's source schema,
 *  matched by `meta.rootId` when the draft recorded one, rather than
 *  unconditionally the first root — a multi-root pipeline's second root has
 *  its own distinct source schema.
 *
 *  Extracted as a pure, independently-testable function (skeptic-final-1.md
 *  non-blocking note) rather than left as a closure inside the hook: every
 *  reachable state via `handleAddLaneStep`'s own insertion ordering
 *  (`anchorIndex + 1`) happens to keep a fresh draft array-adjacent to its
 *  true anchor, so a live-UI-driven test cannot actually FORCE the two
 *  resolution strategies (anchor-based vs. array-position) to disagree —
 *  only a test that controls `steps` order and `meta.parentStepId`
 *  independently, as this function's signature allows, can. */
export function resolveDraftFallbackSchema(
  stepId: string,
  steps: Step[],
  getAnalyzeEntry: (stepId: string) => DraftFallbackAnalyzeEntry | undefined,
  getRootSourceSchema: (rootId: string | undefined) => SchemaField[],
  meta: { parentStepId?: string; rootId?: string } | undefined,
): SchemaField[] {
  if (meta?.parentStepId) {
    const parentEntry = getAnalyzeEntry(meta.parentStepId);
    if (parentEntry) return parentEntry.outputSchema;
    return getRootSourceSchema(meta.rootId);
  }
  const index = steps.findIndex((s) => s.id === stepId);
  for (let i = index - 1; i >= 0; i--) {
    const entry = getAnalyzeEntry(steps[i].id);
    if (entry) return entry.outputSchema;
  }
  return getRootSourceSchema(meta?.rootId);
}

export function pipelineStepToStep(ps: PipelineStep): Step {
  // Join is excluded from the picker (OP_TYPES) but must still resolve
  // correctly when a backend-loaded step has type "join".
  const opType =
    ps.type === "join"
      ? JOIN_OP_TYPE
      : (OP_TYPES.find((op) => op.id === ps.type) ?? unsupportedOpType(ps.type));
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
    parentStepId: ps.parentStepId ?? undefined,
    position: ps.position,
    rootId: ps.rootId ?? undefined,
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

const DEFAULT_SECONDARY_INPUT: SecondaryInput = { kind: "source", dataSourceId: "" };

export function unionConfigOf(step: Step): UnionConfigValue {
  const empty: UnionConfigValue = { secondary: DEFAULT_SECONDARY_INPUT, mode: "byPosition" };
  if (step.opType.id !== "union") return empty;
  const cfg = step.config as UnionConfigType;
  // HEL-912: the narrowed UI value now carries the full discriminated
  // `secondary` arm straight through (source OR lane) -- the HEL-911
  // "degrade lane-kind to empty string" branch this replaced silently
  // DISCARDED a stored lane reference on any subsequent edit; see
  // design.md Decision 4.
  return {
    secondary: cfg.secondaryInput ?? DEFAULT_SECONDARY_INPUT,
    mode: cfg.mode === "byName" ? "byName" : "byPosition",
  };
}

export function lookupConfigOf(step: Step): LookupConfigValue {
  const empty: LookupConfigValue = {
    secondary: DEFAULT_SECONDARY_INPUT,
    sourceKey: "",
    lookupKey: "",
    columns: [],
  };
  if (step.opType.id !== "lookup") return empty;
  const cfg = step.config as LookupConfigType;
  // HEL-912: same full-passthrough widening as unionConfigOf above.
  return {
    secondary: cfg.secondaryInput ?? DEFAULT_SECONDARY_INPUT,
    sourceKey: cfg.sourceKey ?? "",
    lookupKey: cfg.lookupKey ?? "",
    columns: Array.isArray(cfg.columns) ? cfg.columns : [],
  };
}

/** HEL-1102 evaluation-1.md CR1: the backend's `UpsertSourceConfig.decode` substitutes
 *  `UpsertTarget.Default = ExistingSource("")` for a genuinely absent `target` (HEL-1099's own
 *  tolerant-incomplete-draft contract, `UpsertSourceConfig.scala:131-135`), and `format.write`
 *  always serializes a concrete `target` object -- there is no wire shape where `target` is
 *  actually omitted once a step has round-tripped through the real backend. A freshly-added
 *  step therefore comes back as `{kind:"existingSource", dataSourceId:""}`, never `undefined`.
 *  This is the SAME "no target chosen yet" sentinel as an absent `target`, not a real
 *  existing-source selection -- treating it as one is exactly the HEL-386/620 picker-empty-
 *  default defect design.md Decision 3 forbids. */
export function isUnconfiguredUpsertTarget(target: UpsertTarget | undefined): boolean {
  return target === undefined || (target.kind === "existingSource" && target.dataSourceId === "");
}

/** HEL-1102: narrows `step.config` to `UpsertSourceConfigValue` -- `target` stays possibly
 *  `undefined` (design.md Decision 3, mirrors the backend's own tolerant-absent-target
 *  decode) rather than being synthesized into a fake default the way every other secondary-
 *  input config's `DEFAULT_SECONDARY_INPUT` fallback does. Normalizes the backend's own
 *  `ExistingSource("")` round-trip sentinel to `undefined` (evaluation-1.md CR1) so a
 *  freshly-added, not-yet-configured step never renders as if "existing dataset" were chosen. */
export function upsertSourceConfigOf(step: Step): UpsertSourceConfigValue {
  const empty: UpsertSourceConfigValue = { target: undefined, mode: "append" };
  if (step.opType.id !== "upsertsource") return empty;
  const cfg = step.config as UpsertSourceConfigType;
  return {
    target: isUnconfiguredUpsertTarget(cfg.target) ? undefined : cfg.target,
    mode: cfg.mode === "replace" ? "replace" : "append",
  };
}

export interface ConvertFormatConfigValue {
  field: string;
  from?: ConvertFormatFrom;
  to?: ConvertFormatTo;
  outputField?: string;
}

/** design.md D2 -- an unsupported persisted pair (a legacy or agent-authored
 *  step whose `from`/`to` is not one of `SUPPORTED_CONVERT_FORMAT_PAIRS`) is
 *  preserved verbatim, not coerced to one of the four (`SortConfig.tsx:68-76`
 *  precedent). */
export function convertFormatConfigOf(step: Step): ConvertFormatConfigValue {
  const empty: ConvertFormatConfigValue = { field: "" };
  if (step.opType.id !== "convertformat") return empty;
  const cfg = step.config as ConvertFormatConfigType;
  return {
    field: cfg.field ?? "",
    from: cfg.from,
    to: cfg.to,
    outputField: cfg.outputField ?? undefined,
  };
}

export interface AnalyzeWithAiConfigValue {
  inputField: string;
  instruction: string;
  outputSchema: OutputSchemaField[];
}

export function analyzeWithAiConfigOf(step: Step): AnalyzeWithAiConfigValue {
  const empty: AnalyzeWithAiConfigValue = { inputField: "", instruction: "", outputSchema: [] };
  if (step.opType.id !== "analyzewithai") return empty;
  const cfg = step.config as AnalyzeWithAiConfigType;
  return {
    inputField: cfg.inputField ?? "",
    instruction: cfg.instruction ?? "",
    outputSchema: Array.isArray(cfg.outputSchema) ? cfg.outputSchema : [],
  };
}

export interface GenerateTextConfigValue {
  inputField: string;
  instruction: string;
  outputField: string;
}

export function generateTextConfigOf(step: Step): GenerateTextConfigValue {
  const empty: GenerateTextConfigValue = { inputField: "", instruction: "", outputField: "" };
  if (step.opType.id !== "generatetext") return empty;
  const cfg = step.config as GenerateTextConfigType;
  return {
    inputField: cfg.inputField ?? "",
    instruction: cfg.instruction ?? "",
    outputField: cfg.outputField ?? "",
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
