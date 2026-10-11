import type {
  AnalyzeWithAiConfigValue,
  ConvertFormatConfigValue,
  GenerateTextConfigValue,
} from "../state/stepNarrowing";
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
  joinConfig: JoinConfigValue;
  assertConfig: AssertConfigValue;
  upsertSourceConfig: UpsertSourceConfigValue;
  convertFormatConfig: ConvertFormatConfigValue;
  analyzeWithAiConfig: AnalyzeWithAiConfigValue;
  generateTextConfig: GenerateTextConfigValue;
  /** design.md Decision 6 — the current rejected-`persist()` message for
   *  THIS step, or `null` when there is none. Scoped narrowly: only ever
   *  populated by `onUpsertSourceChange`'s persist call site (in `stepCardOpHandlers.ts`), per this
   *  ticket's own decision (other op kinds keep their pre-existing
   *  swallow-on-reject behavior). Cleared at the start of the next `persist`
   *  attempt (success or failure). */
  saveError: string | null;
  /** HEL-1422: true only while `saveError` holds a validation rejection (HTTP 422), i.e. the
   *  server judged the value itself invalid. A network/5xx failure leaves it false. Additive:
   *  `UpsertSourceConfig` keeps rendering `saveError` alone. */
  saveErrorIsValidation: boolean;
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
  onJoinChange: (config: JoinConfigValue) => void;
  onAssertChange: (config: AssertConfigValue) => void;
  onUpsertSourceChange: (config: UpsertSourceConfigValue) => void;
  onConvertFormatChange: (config: ConvertFormatConfigValue) => void;
  onAnalyzeWithAiChange: (config: AnalyzeWithAiConfigValue) => void;
  onGenerateTextChange: (config: GenerateTextConfigValue) => void;
}
