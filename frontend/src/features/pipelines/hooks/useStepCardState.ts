// useStepCardState — local editor state + persistence helpers for one
// pipeline-step row inside StepCard.
//
// Extracted from StepCard.tsx purely as a structural decomposition: the
// hook owns the eight per-op-kind editor states, keeps them in sync with
// the persisted `step.config` via the during-render `prev*` pattern, and
// exposes a single `persist` plus eight typed change handlers that update
// local state and PATCH in lockstep. StepCard.tsx becomes a presentational
// shell over this hook.

import { useEffect, useRef, useState } from "react";

import { updatePipelineStep } from "../services/pipelineService";
import { extractErrorMessage } from "../../../services/extractErrorMessage";
import { isTempStepId, isUnsupportedOpType } from "../state/stepNarrowing";
import {
  aggregateConfigOf,
  analyzeWithAiConfigOf,
  assertConfigOf,
  castsOf,
  chunkByTokenCountConfigOf,
  computeConfigOf,
  convertFormatConfigOf,
  dateBucketConfigOf,
  dedupeConfigOf,
  extractHeadingsConfigOf,
  fillNullConfigOf,
  filterConfigOf,
  generateTextConfigOf,
  limitCountOf,
  lookupConfigOf,
  pivotConfigOf,
  renamesOf,
  selectedFieldsOf,
  sortConfigOf,
  splitTextConfigOf,
  stringOpsConfigOf,
  unionConfigOf,
  unpivotConfigOf,
  upsertSourceConfigOf,
  windowConfigOf,
} from "../state/stepNarrowing";
import type {
  AnalyzeWithAiConfigValue,
  ConvertFormatConfigValue,
  GenerateTextConfigValue,
} from "../state/stepNarrowing";
import type { PipelineStepConfig } from "../types/pipelineStep";
import type { Step } from "../types/step";
import type { AggregateConfigValue } from "../ui/stepConfigs/AggregateConfig";
import type { AssertConfigValue } from "../ui/stepConfigs/AssertConfig";
import type { ChunkByTokenCountConfigValue } from "../ui/stepConfigs/ChunkByTokenCountConfig";
import type { ComputeConfigValue } from "../ui/stepConfigs/ComputeFieldConfig";
import type { DateBucketConfigValue } from "../ui/stepConfigs/DateBucketConfig";
import type { DedupeConfigValue } from "../ui/stepConfigs/DedupeConfig";
import type { ExtractHeadingsConfigValue } from "../ui/stepConfigs/ExtractHeadingsConfig";
import type { FillNullConfigValue } from "../ui/stepConfigs/FillNullConfig";
import type { FilterConfigValue } from "../ui/stepConfigs/FilterConfig";
import type { LookupConfigValue } from "../ui/stepConfigs/LookupConfig";
import type { PivotConfigValue } from "../ui/stepConfigs/PivotConfig";
import type { SortKey } from "../ui/stepConfigs/SortConfig";
import type { SplitTextConfigValue } from "../ui/stepConfigs/SplitTextConfig";
import type { StringOpsConfigValue } from "../ui/stepConfigs/StringOpsConfig";
import type { UnionConfigValue } from "../ui/stepConfigs/UnionConfig";
import type { UnpivotConfigValue } from "../ui/stepConfigs/UnpivotConfig";
import type { UpsertSourceConfigValue } from "../ui/stepConfigs/UpsertSourceConfig";
import type { WindowConfigValue } from "../ui/stepConfigs/WindowConfig";

/** Debounce window (ms) between the last config-editor edit and the
 *  persisted PATCH — matches the hand-rolled ref+setTimeout debounce idiom
 *  used by `ComputedFieldForm.tsx` / `TableRenderer.tsx`'s column-resize
 *  persistence (`RESIZE_PERSIST_DEBOUNCE_MS`). Every step-config editor
 *  (filter values, compute expressions, renames, casts, …) previously
 *  PATCHed the backend on every keystroke; debouncing collapses a burst of
 *  edits into one request. */
const STEP_CONFIG_PERSIST_DEBOUNCE_MS = 400;

export interface StepCardStateHandlers {
  selectedFields: string[];
  renames: Record<string, string>;
  casts: Record<string, string>;
  filterConfig: FilterConfigValue;
  computeConfig: ComputeConfigValue;
  aggregateConfig: AggregateConfigValue;
  limitCount: number;
  sortConfig: SortKey[];
  splitTextConfig: SplitTextConfigValue;
  extractHeadingsConfig: ExtractHeadingsConfigValue;
  chunkByTokenCountConfig: ChunkByTokenCountConfigValue;
  dateBucketConfig: DateBucketConfigValue;
  pivotConfig: PivotConfigValue;
  windowConfig: WindowConfigValue;
  unpivotConfig: UnpivotConfigValue;
  dedupeConfig: DedupeConfigValue;
  fillNullConfig: FillNullConfigValue;
  stringOpsConfig: StringOpsConfigValue;
  unionConfig: UnionConfigValue;
  lookupConfig: LookupConfigValue;
  assertConfig: AssertConfigValue;
  upsertSourceConfig: UpsertSourceConfigValue;
  convertFormatConfig: ConvertFormatConfigValue;
  analyzeWithAiConfig: AnalyzeWithAiConfigValue;
  generateTextConfig: GenerateTextConfigValue;
  /** design.md Decision 6 — the current rejected-`persist()` message for
   *  THIS step, or `null` when there is none. Scoped narrowly: only ever
   *  populated by `onUpsertSourceChange`'s persist call site below, per this
   *  ticket's own decision (other op kinds keep their pre-existing
   *  swallow-on-reject behavior). Cleared at the start of the next `persist`
   *  attempt (success or failure). */
  saveError: string | null;
  onFieldToggle: (field: string, checked: boolean) => void;
  onRenameChange: (field: string, newName: string) => void;
  onCastChange: (field: string, targetType: string) => void;
  onFilterChange: (config: FilterConfigValue) => void;
  onComputeChange: (config: ComputeConfigValue) => void;
  onAggregateChange: (config: AggregateConfigValue) => void;
  onLimitChange: (config: { count: number }) => void;
  onSortChange: (config: { sortBy: SortKey[] }) => void;
  onSplitTextChange: (config: SplitTextConfigValue) => void;
  onExtractHeadingsChange: (config: ExtractHeadingsConfigValue) => void;
  onChunkByTokenCountChange: (config: ChunkByTokenCountConfigValue) => void;
  onDateBucketChange: (config: DateBucketConfigValue) => void;
  onPivotChange: (config: PivotConfigValue) => void;
  onWindowChange: (config: WindowConfigValue) => void;
  onUnpivotChange: (config: UnpivotConfigValue) => void;
  onDedupeChange: (config: DedupeConfigValue) => void;
  onFillNullChange: (config: FillNullConfigValue) => void;
  onStringOpsChange: (config: StringOpsConfigValue) => void;
  onUnionChange: (config: UnionConfigValue) => void;
  onLookupChange: (config: LookupConfigValue) => void;
  onAssertChange: (config: AssertConfigValue) => void;
  onUpsertSourceChange: (config: UpsertSourceConfigValue) => void;
  onConvertFormatChange: (config: ConvertFormatConfigValue) => void;
  onAnalyzeWithAiChange: (config: AnalyzeWithAiConfigValue) => void;
  onGenerateTextChange: (config: GenerateTextConfigValue) => void;
}

export function useStepCardState(
  step: Step,
  /** Called after a successful PATCH so the parent can keep step.config in sync. */
  onConfigChange: (stepId: string, config: PipelineStepConfig) => void,
): StepCardStateHandlers {
  // Derived state: sync local editor state when the persisted config or
  // opType changes (during-render pattern). CS2c-3a: `step.config` is
  // already a typed object, so the narrowing helpers replace the per-render
  // JSON parsing the pre-CS2c-3a editor performed.
  const [prevConfig, setPrevConfig] = useState(step.config);
  const [prevOpTypeId, setPrevOpTypeId] = useState(step.opType.id);
  const [selectedFields, setSelectedFields] = useState<string[]>(() => selectedFieldsOf(step));
  const [renames, setRenames] = useState<Record<string, string>>(() => renamesOf(step));
  const [casts, setCasts] = useState<Record<string, string>>(() => castsOf(step));
  const [filterConfig, setFilterConfig] = useState<FilterConfigValue>(() => filterConfigOf(step));
  const [computeConfig, setComputeConfig] = useState<ComputeConfigValue>(() =>
    computeConfigOf(step),
  );
  const [aggregateConfig, setAggregateConfig] = useState<AggregateConfigValue>(() =>
    aggregateConfigOf(step),
  );
  const [limitCount, setLimitCount] = useState<number>(() => limitCountOf(step));
  const [sortConfig, setSortConfig] = useState<SortKey[]>(() => sortConfigOf(step));
  const [splitTextConfig, setSplitTextConfig] = useState<SplitTextConfigValue>(() =>
    splitTextConfigOf(step),
  );
  const [extractHeadingsConfig, setExtractHeadingsConfig] = useState<ExtractHeadingsConfigValue>(
    () => extractHeadingsConfigOf(step),
  );
  const [chunkByTokenCountConfig, setChunkByTokenCountConfig] =
    useState<ChunkByTokenCountConfigValue>(() => chunkByTokenCountConfigOf(step));
  const [dateBucketConfig, setDateBucketConfig] = useState<DateBucketConfigValue>(() =>
    dateBucketConfigOf(step),
  );
  const [pivotConfig, setPivotConfig] = useState<PivotConfigValue>(() => pivotConfigOf(step));
  const [windowConfig, setWindowConfig] = useState<WindowConfigValue>(() => windowConfigOf(step));
  const [unpivotConfig, setUnpivotConfig] = useState<UnpivotConfigValue>(() =>
    unpivotConfigOf(step),
  );
  const [dedupeConfig, setDedupeConfig] = useState<DedupeConfigValue>(() => dedupeConfigOf(step));
  const [fillNullConfig, setFillNullConfig] = useState<FillNullConfigValue>(() =>
    fillNullConfigOf(step),
  );
  const [stringOpsConfig, setStringOpsConfig] = useState<StringOpsConfigValue>(() =>
    stringOpsConfigOf(step),
  );
  const [unionConfig, setUnionConfig] = useState<UnionConfigValue>(() => unionConfigOf(step));
  const [lookupConfig, setLookupConfig] = useState<LookupConfigValue>(() => lookupConfigOf(step));
  const [assertConfig, setAssertConfig] = useState<AssertConfigValue>(() => assertConfigOf(step));
  const [upsertSourceConfig, setUpsertSourceConfig] = useState<UpsertSourceConfigValue>(() =>
    upsertSourceConfigOf(step),
  );
  const [convertFormatConfig, setConvertFormatConfig] = useState<ConvertFormatConfigValue>(() =>
    convertFormatConfigOf(step),
  );
  const [analyzeWithAiConfig, setAnalyzeWithAiConfig] = useState<AnalyzeWithAiConfigValue>(() =>
    analyzeWithAiConfigOf(step),
  );
  const [generateTextConfig, setGenerateTextConfig] = useState<GenerateTextConfigValue>(() =>
    generateTextConfigOf(step),
  );
  // design.md Decision 6 — scoped to `upsertsource` only (see the field's
  // own doc on `StepCardStateHandlers` above).
  const [saveError, setSaveError] = useState<string | null>(null);
  if (prevConfig !== step.config || prevOpTypeId !== step.opType.id) {
    setPrevConfig(step.config);
    setPrevOpTypeId(step.opType.id);
    setSelectedFields(selectedFieldsOf(step));
    setRenames(renamesOf(step));
    setCasts(castsOf(step));
    setFilterConfig(filterConfigOf(step));
    setComputeConfig(computeConfigOf(step));
    setAggregateConfig(aggregateConfigOf(step));
    setLimitCount(limitCountOf(step));
    setSortConfig(sortConfigOf(step));
    setSplitTextConfig(splitTextConfigOf(step));
    setExtractHeadingsConfig(extractHeadingsConfigOf(step));
    setChunkByTokenCountConfig(chunkByTokenCountConfigOf(step));
    setDateBucketConfig(dateBucketConfigOf(step));
    setPivotConfig(pivotConfigOf(step));
    setWindowConfig(windowConfigOf(step));
    setUnpivotConfig(unpivotConfigOf(step));
    setDedupeConfig(dedupeConfigOf(step));
    setFillNullConfig(fillNullConfigOf(step));
    setStringOpsConfig(stringOpsConfigOf(step));
    setUnionConfig(unionConfigOf(step));
    setLookupConfig(lookupConfigOf(step));
    setAssertConfig(assertConfigOf(step));
    setUpsertSourceConfig(upsertSourceConfigOf(step));
    setConvertFormatConfig(convertFormatConfigOf(step));
    setAnalyzeWithAiConfig(analyzeWithAiConfigOf(step));
    setGenerateTextConfig(generateTextConfigOf(step));
  }

  // Debounce ref for the persist path below, plus a monotonically
  // increasing request token: `persist` may be called many times in a row
  // (one keystroke = one call, across any of the 20 change handlers) but
  // must only PATCH once the caller stops calling for
  // STEP_CONFIG_PERSIST_DEBOUNCE_MS. The token additionally guards against
  // an *out-of-order response* — e.g. the network reorders two PATCHes so an
  // older request's response arrives after a newer one's — by only applying
  // a response to `onConfigChange` when it's still the most recently
  // *dispatched* request for this step.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestTokenRef = useRef(0);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  /** Shared persistence path — debounces, then PATCHes the typed config and
   *  notifies the parent. Local editor state is updated by the caller (so
   *  the UI stays responsive regardless of debounce/network latency).
   *
   *  `captureErrors` (design.md Decision 6, currently only passed `true` by
   *  `onUpsertSourceChange`) opts a call site INTO surfacing a rejected
   *  PATCH's backend message via `saveError` — every other op kind keeps
   *  the pre-existing silent-swallow behavior (out of scope to change here)
   *  by omitting it. */
  function persist(newConfig: PipelineStepConfig, captureErrors = false): void {
    // HEL-1100 (design.md Decision 9): an unsupported step kind has no config editor that could
    // have produced this call in the first place, but the pending-`onChange` type shape allows
    // it to be invoked with a stale/default value regardless -- skip the PATCH entirely rather
    // than persisting a config no editor here actually computed.
    if (isUnsupportedOpType(step.opType)) return;
    // HEL-1109 (design.md D3) — a step still carrying its `makeStep`-minted
    // temp id (exactly `step-<counter>`, e.g. "step-1") has no server-side
    // row yet: PATCHing it would 404 (swallowed for every kind except
    // `upsertsource`, which is the only call site that captures errors
    // today). This was a latent defect before this ticket (the removed
    // `handleInsertStep:685` comment claiming otherwise was itself wrong,
    // design.md D3) -- fixed here, for every op, rather than wiring each
    // draft card to withhold `persist` individually. Uses the single
    // `isTempStepId` source of truth (evaluation-1.md CR3) -- a semantic
    // test-fixture id like "step-rename-1" is NOT a temp id and must still
    // PATCH normally.
    if (isTempStepId(step.id)) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const token = ++requestTokenRef.current;
      // Cleared at the start of THIS attempt (success or failure) so a stale error from a
      // previous rejected PATCH never lingers past a subsequent try.
      if (captureErrors) setSaveError(null);
      void updatePipelineStep(step.id, newConfig)
        .then(() => {
          // Drop a stale response: a newer edit may have already dispatched
          // (and possibly already resolved) its own PATCH while this one
          // was in flight.
          if (requestTokenRef.current === token) {
            onConfigChange(step.id, newConfig);
          }
        })
        .catch((err: unknown) => {
          // The same `requestTokenRef` staleness guard as the success path above: an
          // out-of-order/superseded rejection must never clobber a newer, still-in-flight or
          // already-succeeded request's result.
          if (captureErrors && requestTokenRef.current === token) {
            setSaveError(
              extractErrorMessage(
                err,
                "Failed to save this step's target or mode — the server didn't say why.",
              ),
            );
          }
          // Every other op kind: no-op, local state always reflects user intent even if the
          // PATCH fails (pre-existing behavior, unchanged by this ticket — design.md Decision 6).
        });
    }, STEP_CONFIG_PERSIST_DEBOUNCE_MS);
  }

  function onFieldToggle(field: string, checked: boolean) {
    const next = checked ? [...selectedFields, field] : selectedFields.filter((f) => f !== field);
    setSelectedFields(next);
    persist({ fields: next });
  }

  function onRenameChange(field: string, newName: string) {
    const next = { ...renames };
    if (newName) next[field] = newName;
    else delete next[field];
    setRenames(next);
    persist({ renames: next });
  }

  function onCastChange(field: string, targetType: string) {
    const next = { ...casts };
    if (targetType) next[field] = targetType;
    else delete next[field];
    setCasts(next);
    persist({ casts: next });
  }

  function onFilterChange(newConfig: FilterConfigValue) {
    setFilterConfig(newConfig);
    persist({
      combinator: newConfig.combinator,
      conditions: newConfig.conditions,
    });
  }

  function onComputeChange(newConfig: ComputeConfigValue) {
    setComputeConfig(newConfig);
    persist(newConfig);
  }

  function onAggregateChange(newConfig: AggregateConfigValue) {
    setAggregateConfig(newConfig);
    persist(newConfig);
  }

  function onLimitChange(newConfig: { count: number }) {
    setLimitCount(newConfig.count);
    persist(newConfig);
  }

  function onSortChange(newConfig: { sortBy: SortKey[] }) {
    setSortConfig(newConfig.sortBy);
    persist(newConfig);
  }

  function onSplitTextChange(newConfig: SplitTextConfigValue) {
    setSplitTextConfig(newConfig);
    persist(newConfig);
  }

  function onExtractHeadingsChange(newConfig: ExtractHeadingsConfigValue) {
    setExtractHeadingsConfig(newConfig);
    persist(newConfig);
  }

  function onChunkByTokenCountChange(newConfig: ChunkByTokenCountConfigValue) {
    setChunkByTokenCountConfig(newConfig);
    persist(newConfig);
  }

  function onDateBucketChange(newConfig: DateBucketConfigValue) {
    setDateBucketConfig(newConfig);
    // Blank outputColumn means "overwrite field in place" — omit the key
    // entirely rather than persisting an empty string (acceptance criterion:
    // "Leaving outputColumn blank omits it from the config").
    persist({
      field: newConfig.field,
      granularity: newConfig.granularity,
      outputColumn: newConfig.outputColumn ? newConfig.outputColumn : undefined,
    });
  }

  function onPivotChange(newConfig: PivotConfigValue) {
    setPivotConfig(newConfig);
    persist(newConfig);
  }

  function onWindowChange(newConfig: WindowConfigValue) {
    setWindowConfig(newConfig);
    // `field` is only meaningful for running_sum/lag/lead (ignored by the
    // rank family); `offset` only for lag/lead. Omit them from the
    // persisted config when the selected function doesn't use them, rather
    // than persisting a stale value from a previously-selected function.
    const usesField =
      newConfig.function === "running_sum" ||
      newConfig.function === "lag" ||
      newConfig.function === "lead";
    const usesOffset = newConfig.function === "lag" || newConfig.function === "lead";
    persist({
      partitionBy: newConfig.partitionBy,
      orderBy: newConfig.orderBy,
      function: newConfig.function,
      field: usesField && newConfig.field ? newConfig.field : undefined,
      outputColumn: newConfig.outputColumn,
      offset: usesOffset ? newConfig.offset : undefined,
    });
  }

  function onUnpivotChange(newConfig: UnpivotConfigValue) {
    setUnpivotConfig(newConfig);
    persist(newConfig);
  }

  function onDedupeChange(newConfig: DedupeConfigValue) {
    setDedupeConfig(newConfig);
    persist(newConfig);
  }

  function onFillNullChange(newConfig: FillNullConfigValue) {
    setFillNullConfig(newConfig);
    persist(newConfig);
  }

  function onStringOpsChange(newConfig: StringOpsConfigValue) {
    setStringOpsConfig(newConfig);
    // Each operation only reads a subset of the params — omit the ones the
    // selected operation doesn't use rather than persisting a stale value
    // left over from a previously-selected operation (mirrors
    // onWindowChange's usesField/usesOffset omission pattern above).
    const isConcat = newConfig.operation === "concat";
    const usesSeparator = newConfig.operation === "split" || isConcat;
    const usesIndex = newConfig.operation === "split";
    const usesPattern = newConfig.operation === "extractRegex";
    persist({
      operation: newConfig.operation,
      field: isConcat ? "" : newConfig.field,
      outputColumn: newConfig.outputColumn,
      pattern: usesPattern && newConfig.pattern ? newConfig.pattern : undefined,
      separator: usesSeparator && newConfig.separator ? newConfig.separator : undefined,
      index: usesIndex ? newConfig.index : undefined,
      fields: isConcat ? newConfig.fields : undefined,
    });
  }

  function onUnionChange(newConfig: UnionConfigValue) {
    setUnionConfig(newConfig);
    // HEL-912: the discriminated `secondary` arm (source OR lane) widens
    // straight through to the wire's `secondaryInput` -- the HEL-911
    // unconditional `{kind:"source"}` this replaced would silently
    // overwrite a stored lane reference on any subsequent edit.
    persist({
      secondaryInput: newConfig.secondary,
      mode: newConfig.mode,
    });
  }

  function onLookupChange(newConfig: LookupConfigValue) {
    setLookupConfig(newConfig);
    // HEL-912: same straight-through widening as onUnionChange above.
    persist({
      secondaryInput: newConfig.secondary,
      sourceKey: newConfig.sourceKey,
      lookupKey: newConfig.lookupKey,
      columns: newConfig.columns,
    });
  }

  function onAssertChange(newConfig: AssertConfigValue) {
    setAssertConfig(newConfig);
    persist(newConfig);
  }

  function onUpsertSourceChange(newConfig: UpsertSourceConfigValue) {
    setUpsertSourceConfig(newConfig);
    persist({ target: newConfig.target, mode: newConfig.mode }, true);
  }

  /** HEL-1109 (design.md D3) — a not-yet-created draft (temp id) has no PATCH
   *  path at all (`persist`'s own guard above), but the parent still needs to
   *  see every edit immediately: `usePipelineDetailPage.handleStepConfigChange`
   *  is what notices a draft's config just became complete and fires its
   *  (exactly-once) create request. A real, persisted step keeps the normal
   *  debounced PATCH path unchanged. */
  function emitOrPersist(newConfig: PipelineStepConfig) {
    if (isTempStepId(step.id)) {
      onConfigChange(step.id, newConfig);
      return;
    }
    persist(newConfig);
  }

  function onConvertFormatChange(newConfig: ConvertFormatConfigValue) {
    setConvertFormatConfig(newConfig);
    emitOrPersist({
      field: newConfig.field,
      from: newConfig.from,
      to: newConfig.to,
      outputField: newConfig.outputField ? newConfig.outputField : undefined,
    });
  }

  function onAnalyzeWithAiChange(newConfig: AnalyzeWithAiConfigValue) {
    setAnalyzeWithAiConfig(newConfig);
    emitOrPersist(newConfig);
  }

  function onGenerateTextChange(newConfig: GenerateTextConfigValue) {
    setGenerateTextConfig(newConfig);
    emitOrPersist(newConfig);
  }

  return {
    selectedFields,
    renames,
    casts,
    filterConfig,
    computeConfig,
    aggregateConfig,
    limitCount,
    sortConfig,
    splitTextConfig,
    extractHeadingsConfig,
    chunkByTokenCountConfig,
    dateBucketConfig,
    pivotConfig,
    windowConfig,
    unpivotConfig,
    dedupeConfig,
    fillNullConfig,
    stringOpsConfig,
    unionConfig,
    lookupConfig,
    assertConfig,
    upsertSourceConfig,
    convertFormatConfig,
    analyzeWithAiConfig,
    generateTextConfig,
    saveError,
    onFieldToggle,
    onRenameChange,
    onCastChange,
    onFilterChange,
    onComputeChange,
    onAggregateChange,
    onLimitChange,
    onSortChange,
    onSplitTextChange,
    onExtractHeadingsChange,
    onChunkByTokenCountChange,
    onDateBucketChange,
    onPivotChange,
    onWindowChange,
    onUnpivotChange,
    onDedupeChange,
    onFillNullChange,
    onStringOpsChange,
    onUnionChange,
    onLookupChange,
    onAssertChange,
    onUpsertSourceChange,
    onConvertFormatChange,
    onAnalyzeWithAiChange,
    onGenerateTextChange,
  };
}
