// StepOpEditor — the per-op-type editor ladder extracted from `StepCard.tsx`
// (HEL-682 split, task 3.2). Purely presentational: dispatches on
// `step.opType.id` to the matching kind-specific `*Config` component, wired
// to the same `useStepCardState` return value the trunk `StepCard` computes.
// Behavior-preserving — no branch logic changed, only relocated.

import type { useStepCardState } from "../hooks/useStepCardState";
import { isUnsupportedOpType } from "../state/stepNarrowing";
import type { SchemaField } from "../types/pipelineStep";
import type { Step } from "../types/step";
import { AggregateConfig } from "./stepConfigs/AggregateConfig";
import { AnalyzeWithAiConfig } from "./stepConfigs/AnalyzeWithAiConfig";
import { AssertConfig } from "./stepConfigs/AssertConfig";
import { CastFieldsConfig } from "./stepConfigs/CastFieldsConfig";
import { ChunkByTokenCountConfig } from "./stepConfigs/ChunkByTokenCountConfig";
import { ComputeFieldConfig } from "./stepConfigs/ComputeFieldConfig";
import { ConvertFormatConfig } from "./stepConfigs/ConvertFormatConfig";
import { DateBucketConfig } from "./stepConfigs/DateBucketConfig";
import { DedupeConfig } from "./stepConfigs/DedupeConfig";
import { ExtractHeadingsConfig } from "./stepConfigs/ExtractHeadingsConfig";
import { FillNullConfig } from "./stepConfigs/FillNullConfig";
import { FilterConfig } from "./stepConfigs/FilterConfig";
import { GenerateTextConfig } from "./stepConfigs/GenerateTextConfig";
import { LimitConfig } from "./stepConfigs/LimitConfig";
import { LookupConfig } from "./stepConfigs/LookupConfig";
import { PivotConfig } from "./stepConfigs/PivotConfig";
import { RenameFieldsConfig } from "./stepConfigs/RenameFieldsConfig";
import { SortConfig } from "./stepConfigs/SortConfig";
import { SelectFieldsConfig } from "./stepConfigs/SelectFieldsConfig";
import { SplitTextConfig } from "./stepConfigs/SplitTextConfig";
import { StringOpsConfig } from "./stepConfigs/StringOpsConfig";
import { UnionConfig } from "./stepConfigs/UnionConfig";
import { UnpivotConfig } from "./stepConfigs/UnpivotConfig";
import { UpsertSourceConfig } from "./stepConfigs/UpsertSourceConfig";
import { WindowConfig } from "./stepConfigs/WindowConfig";

interface StepOpEditorProps {
  step: Step;
  /** HEL-912 task 5.3 — every step in the pipeline, threaded through to
   *  union/lookup's SecondaryInputPicker. Optional/defaults to `[]`. */
  allSteps?: Step[];
  analyzeColumns: string[];
  analyzeSchema: SchemaField[];
  validationError?: string;
  /** HEL-1102 (design.md Decision 2) — true only for the pipeline's owner;
   *  threaded through to `UpsertSourceConfig`'s target picker, which
   *  disables the "existing dataset" option for a non-owner editor grantee. */
  isOwner: boolean;
  /** HEL-1109 (design.md D5) — threaded to the AI cards' cost disclosure. */
  estimatedRows?: number;
  stepCardState: ReturnType<typeof useStepCardState>;
}

const EMPTY_ALL_STEPS: Step[] = [];

export function StepOpEditor({
  step,
  allSteps = EMPTY_ALL_STEPS,
  analyzeColumns,
  analyzeSchema,
  validationError,
  isOwner,
  estimatedRows,
  stepCardState,
}: StepOpEditorProps) {
  const {
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
  } = stepCardState;

  // HEL-1100 (design.md Decision 9): a persisted step whose kind this frontend build doesn't
  // recognize (e.g. `upsertsource` before HEL-1102's real step card ships) renders a read-only
  // notice rather than any config editor -- there is no `*Config` component to dispatch to, and
  // no edit this UI could produce would round-trip correctly.
  if (isUnsupportedOpType(step.opType)) {
    return (
      <p className="pipeline-detail-page__step-card-desc">
        This step type is not yet supported in this version of the pipeline editor. Its
        configuration is preserved, but it cannot be edited here.
      </p>
    );
  }

  if (step.opType.id === "select") {
    return (
      <SelectFieldsConfig
        columns={analyzeColumns}
        selectedFields={selectedFields}
        onToggle={onFieldToggle}
      />
    );
  }
  if (step.opType.id === "rename") {
    return (
      <RenameFieldsConfig columns={analyzeColumns} renames={renames} onChange={onRenameChange} />
    );
  }
  if (step.opType.id === "cast") {
    return <CastFieldsConfig columns={analyzeColumns} casts={casts} onChange={onCastChange} />;
  }
  if (step.opType.id === "filter") {
    return (
      <FilterConfig config={filterConfig} analyzeSchema={analyzeSchema} onChange={onFilterChange} />
    );
  }
  if (step.opType.id === "compute") {
    return (
      <ComputeFieldConfig
        config={computeConfig}
        analyzeColumns={analyzeColumns}
        validationError={validationError}
        onChange={onComputeChange}
      />
    );
  }
  if (step.opType.id === "aggregate") {
    return (
      <AggregateConfig
        config={aggregateConfig}
        analyzeSchema={analyzeSchema}
        analyzeColumns={analyzeColumns}
        onChange={onAggregateChange}
      />
    );
  }
  if (step.opType.id === "limit") {
    return <LimitConfig count={limitCount} onChange={onLimitChange} />;
  }
  if (step.opType.id === "sort") {
    return <SortConfig sortBy={sortConfig} columns={analyzeColumns} onChange={onSortChange} />;
  }
  if (step.opType.id === "splittext") {
    return (
      <SplitTextConfig
        config={splitTextConfig}
        analyzeSchema={analyzeSchema}
        onChange={onSplitTextChange}
      />
    );
  }
  if (step.opType.id === "extractheadings") {
    return (
      <ExtractHeadingsConfig
        config={extractHeadingsConfig}
        analyzeSchema={analyzeSchema}
        onChange={onExtractHeadingsChange}
      />
    );
  }
  if (step.opType.id === "chunkbytokencount") {
    return (
      <ChunkByTokenCountConfig
        config={chunkByTokenCountConfig}
        analyzeSchema={analyzeSchema}
        onChange={onChunkByTokenCountChange}
      />
    );
  }
  if (step.opType.id === "datebucket") {
    return (
      <DateBucketConfig
        config={dateBucketConfig}
        analyzeColumns={analyzeColumns}
        onChange={onDateBucketChange}
      />
    );
  }
  if (step.opType.id === "pivot") {
    return (
      <PivotConfig
        config={pivotConfig}
        analyzeSchema={analyzeSchema}
        analyzeColumns={analyzeColumns}
        onChange={onPivotChange}
      />
    );
  }
  if (step.opType.id === "window") {
    return (
      <WindowConfig
        config={windowConfig}
        analyzeSchema={analyzeSchema}
        analyzeColumns={analyzeColumns}
        onChange={onWindowChange}
      />
    );
  }
  if (step.opType.id === "unpivot") {
    return (
      <UnpivotConfig
        config={unpivotConfig}
        analyzeSchema={analyzeSchema}
        onChange={onUnpivotChange}
      />
    );
  }
  if (step.opType.id === "dedupe") {
    return (
      <DedupeConfig
        config={dedupeConfig}
        analyzeColumns={analyzeColumns}
        onChange={onDedupeChange}
      />
    );
  }
  if (step.opType.id === "fillnull") {
    return (
      <FillNullConfig
        config={fillNullConfig}
        analyzeColumns={analyzeColumns}
        onChange={onFillNullChange}
      />
    );
  }
  if (step.opType.id === "stringops") {
    return (
      <StringOpsConfig
        config={stringOpsConfig}
        analyzeSchema={analyzeSchema}
        analyzeColumns={analyzeColumns}
        onChange={onStringOpsChange}
      />
    );
  }
  if (step.opType.id === "union") {
    return (
      <UnionConfig
        config={unionConfig}
        allSteps={allSteps}
        currentStepId={step.id}
        onChange={onUnionChange}
      />
    );
  }
  if (step.opType.id === "lookup") {
    return (
      <LookupConfig
        config={lookupConfig}
        analyzeSchema={analyzeSchema}
        allSteps={allSteps}
        currentStepId={step.id}
        onChange={onLookupChange}
      />
    );
  }
  if (step.opType.id === "assert") {
    return (
      <AssertConfig config={assertConfig} analyzeSchema={analyzeSchema} onChange={onAssertChange} />
    );
  }
  if (step.opType.id === "upsertsource") {
    return (
      <UpsertSourceConfig
        config={upsertSourceConfig}
        isOwner={isOwner}
        saveError={saveError}
        onChange={onUpsertSourceChange}
      />
    );
  }

  if (step.opType.id === "convertformat") {
    return (
      <ConvertFormatConfig
        config={convertFormatConfig}
        analyzeSchema={analyzeSchema}
        onChange={onConvertFormatChange}
      />
    );
  }
  if (step.opType.id === "analyzewithai") {
    return (
      <AnalyzeWithAiConfig
        config={analyzeWithAiConfig}
        analyzeSchema={analyzeSchema}
        estimatedRows={estimatedRows}
        onChange={onAnalyzeWithAiChange}
      />
    );
  }
  if (step.opType.id === "generatetext") {
    return (
      <GenerateTextConfig
        config={generateTextConfig}
        analyzeSchema={analyzeSchema}
        estimatedRows={estimatedRows}
        onChange={onGenerateTextChange}
      />
    );
  }

  return (
    <p className="pipeline-detail-page__step-card-desc">
      Configure this {step.opType.label.toLowerCase()} step.
    </p>
  );
}
