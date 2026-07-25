// useStepCardState — local editor state + persistence helpers for one
// pipeline-step row inside StepCard.
//
// Extracted from StepCard.tsx purely as a structural decomposition: the
// hook owns the eight per-op-kind editor states, keeps them in sync with
// the persisted `step.config` via the during-render `prev*` pattern, and
// exposes a single `persist` plus eight typed change handlers that update
// local state and PATCH in lockstep. StepCard.tsx becomes a presentational
// shell over this hook.

import { useState } from "react";

import { updatePipelineStep } from "../services/pipelineService";
import {
  aggregateConfigOf,
  castsOf,
  chunkByTokenCountConfigOf,
  computeConfigOf,
  dateBucketConfigOf,
  dedupeConfigOf,
  extractHeadingsConfigOf,
  fillNullConfigOf,
  filterConfigOf,
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
  windowConfigOf,
} from "../state/stepNarrowing";
import type { PipelineStepConfig } from "../types/pipelineStep";
import type { Step } from "../types/step";
import type { AggregateConfigValue } from "../ui/AggregateConfig";
import type { ChunkByTokenCountConfigValue } from "../ui/ChunkByTokenCountConfig";
import type { ComputeConfigValue } from "../ui/ComputeFieldConfig";
import type { DateBucketConfigValue } from "../ui/DateBucketConfig";
import type { DedupeConfigValue } from "../ui/DedupeConfig";
import type { ExtractHeadingsConfigValue } from "../ui/ExtractHeadingsConfig";
import type { FillNullConfigValue } from "../ui/FillNullConfig";
import type { FilterConfigValue } from "../ui/FilterConfig";
import type { LookupConfigValue } from "../ui/LookupConfig";
import type { PivotConfigValue } from "../ui/PivotConfig";
import type { SortKey } from "../ui/SortConfig";
import type { SplitTextConfigValue } from "../ui/SplitTextConfig";
import type { StringOpsConfigValue } from "../ui/StringOpsConfig";
import type { UnionConfigValue } from "../ui/UnionConfig";
import type { UnpivotConfigValue } from "../ui/UnpivotConfig";
import type { WindowConfigValue } from "../ui/WindowConfig";

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
  }

  /** Shared persistence path — PATCHes the typed config, then notifies the
   *  parent. Local editor state is updated by the caller (so the UI stays
   *  responsive regardless of network result). */
  function persist(newConfig: PipelineStepConfig): void {
    void updatePipelineStep(step.id, newConfig)
      .then(() => {
        onConfigChange(step.id, newConfig);
      })
      .catch(() => {
        // No-op: local state always reflects user intent even if PATCH fails.
      });
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
    persist(newConfig);
  }

  function onLookupChange(newConfig: LookupConfigValue) {
    setLookupConfig(newConfig);
    persist(newConfig);
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
  };
}
