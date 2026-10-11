import { useState } from "react";

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
  joinConfigOf,
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
import type { JoinConfigValue } from "../ui/stepConfigs/JoinConfig";
import type { LookupConfigValue } from "../ui/stepConfigs/LookupConfig";
import type { PivotConfigValue } from "../ui/stepConfigs/PivotConfig";
import type { SortKey } from "../ui/stepConfigs/SortConfig";
import type { SplitTextConfigValue } from "../ui/stepConfigs/SplitTextConfig";
import type { StringOpsConfigValue } from "../ui/stepConfigs/StringOpsConfig";
import type { UnionConfigValue } from "../ui/stepConfigs/UnionConfig";
import type { UnpivotConfigValue } from "../ui/stepConfigs/UnpivotConfig";
import type { UpsertSourceConfigValue } from "../ui/stepConfigs/UpsertSourceConfig";
import type { WindowConfigValue } from "../ui/stepConfigs/WindowConfig";

export function useStepCardEditorState(step: Step) {
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
  const [joinConfig, setJoinConfig] = useState<JoinConfigValue>(() => joinConfigOf(step));
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
  // own doc on `StepCardStateHandlers` in `stepCardStateTypes.ts`).
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveErrorIsValidation, setSaveErrorIsValidation] = useState(false);
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
    setJoinConfig(joinConfigOf(step));
    setAssertConfig(assertConfigOf(step));
    setUpsertSourceConfig(upsertSourceConfigOf(step));
    setConvertFormatConfig(convertFormatConfigOf(step));
    setAnalyzeWithAiConfig(analyzeWithAiConfigOf(step));
    setGenerateTextConfig(generateTextConfigOf(step));
  }
  return {
    selectedFields,
    setSelectedFields,
    renames,
    setRenames,
    casts,
    setCasts,
    filterConfig,
    setFilterConfig,
    computeConfig,
    setComputeConfig,
    aggregateConfig,
    setAggregateConfig,
    limitCount,
    setLimitCount,
    sortConfig,
    setSortConfig,
    splitTextConfig,
    setSplitTextConfig,
    extractHeadingsConfig,
    setExtractHeadingsConfig,
    chunkByTokenCountConfig,
    setChunkByTokenCountConfig,
    dateBucketConfig,
    setDateBucketConfig,
    pivotConfig,
    setPivotConfig,
    windowConfig,
    setWindowConfig,
    unpivotConfig,
    setUnpivotConfig,
    dedupeConfig,
    setDedupeConfig,
    fillNullConfig,
    setFillNullConfig,
    stringOpsConfig,
    setStringOpsConfig,
    unionConfig,
    setUnionConfig,
    lookupConfig,
    setLookupConfig,
    joinConfig,
    setJoinConfig,
    assertConfig,
    setAssertConfig,
    upsertSourceConfig,
    setUpsertSourceConfig,
    convertFormatConfig,
    setConvertFormatConfig,
    analyzeWithAiConfig,
    setAnalyzeWithAiConfig,
    generateTextConfig,
    setGenerateTextConfig,
    saveError,
    setSaveError,
    saveErrorIsValidation,
    setSaveErrorIsValidation,
  };
}
