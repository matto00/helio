import type { AggregateConfigValue } from "../ui/stepConfigs/AggregateConfig";
import type { ChunkByTokenCountConfigValue } from "../ui/stepConfigs/ChunkByTokenCountConfig";
import type { ComputeConfigValue } from "../ui/stepConfigs/ComputeFieldConfig";
import type { DateBucketConfigValue } from "../ui/stepConfigs/DateBucketConfig";
import type { ExtractHeadingsConfigValue } from "../ui/stepConfigs/ExtractHeadingsConfig";
import type { FilterConfigValue } from "../ui/stepConfigs/FilterConfig";
import type { PivotConfigValue } from "../ui/stepConfigs/PivotConfig";
import type { SortKey } from "../ui/stepConfigs/SortConfig";
import type { SplitTextConfigValue } from "../ui/stepConfigs/SplitTextConfig";
import {
  FIELD_REQUIRED_FUNCTIONS,
  ROLLING_FUNCTIONS,
  type WindowConfigValue,
} from "../ui/stepConfigs/WindowConfig";
import type { useStepCardEditorState } from "./useStepCardEditorState";
import type { useStepCardPersist } from "./useStepCardPersist";

type StepCardFieldHandlersArgs = Pick<
  ReturnType<typeof useStepCardEditorState>,
  | "selectedFields"
  | "setSelectedFields"
  | "renames"
  | "setRenames"
  | "casts"
  | "setCasts"
  | "setFilterConfig"
  | "setComputeConfig"
  | "setAggregateConfig"
  | "setLimitCount"
  | "setSortConfig"
  | "setSplitTextConfig"
  | "setExtractHeadingsConfig"
  | "setChunkByTokenCountConfig"
  | "setDateBucketConfig"
  | "setPivotConfig"
  | "setWindowConfig"
> &
  Pick<ReturnType<typeof useStepCardPersist>, "persist">;

export function buildStepCardFieldHandlers({
  selectedFields,
  setSelectedFields,
  renames,
  setRenames,
  casts,
  setCasts,
  setFilterConfig,
  setComputeConfig,
  setAggregateConfig,
  setLimitCount,
  setSortConfig,
  setSplitTextConfig,
  setExtractHeadingsConfig,
  setChunkByTokenCountConfig,
  setDateBucketConfig,
  setPivotConfig,
  setWindowConfig,
  persist,
}: StepCardFieldHandlersArgs) {
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
    // `field` is only meaningful for the field-required functions (running_sum/lag/lead/rolling_*; ignored
    // by the rank family); `offset` only for lag/lead; `frameSize`/`frameUnit` only for rolling_*. Omit the
    // keys (not undefined-valued) when the selected function doesn't use them, rather than persisting a stale
    // value from a previously-selected function.
    const fn = newConfig.function;
    const usesField = FIELD_REQUIRED_FUNCTIONS.includes(fn);
    const usesOffset = fn === "lag" || fn === "lead";
    const usesFrame = ROLLING_FUNCTIONS.includes(fn);
    persist({
      partitionBy: newConfig.partitionBy,
      orderBy: newConfig.orderBy,
      function: fn,
      ...(usesField && newConfig.field ? { field: newConfig.field } : {}),
      outputColumn: newConfig.outputColumn,
      ...(usesOffset ? { offset: newConfig.offset } : {}),
      ...(usesFrame
        ? {
            ...(newConfig.frameSize !== null ? { frameSize: newConfig.frameSize } : {}),
            frameUnit: newConfig.frameUnit,
          }
        : {}),
    });
  }

  return {
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
  };
}
