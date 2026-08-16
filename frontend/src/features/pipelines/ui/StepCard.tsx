// StepCard — one expandable card per pipeline step on the PipelineDetailPage.
// Owns the per-step editor surface (delegating to the kind-specific editors)
// and the local, inline "preview data" panel (rows + output schema — HEL-404).
// Per-op editor state + PATCH-on-change persistence live in `useStepCardState`.

import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

import { useStepCardState } from "../hooks/useStepCardState";
import { DataGrid } from "../../../shared/ui/index";
import { fetchStepPreview } from "../services/pipelineService";
import type { StepPreviewResponse } from "../services/pipelineService";
import { renamesOf } from "../state/stepNarrowing";
import type { PipelineStepConfig, SchemaField } from "../types/pipelineStep";
import type { Step } from "../types/step";
import { AggregateConfig } from "./AggregateConfig";
import { AssertConfig } from "./AssertConfig";
import { CastFieldsConfig } from "./CastFieldsConfig";
import { ChunkByTokenCountConfig } from "./ChunkByTokenCountConfig";
import { ComputeFieldConfig } from "./ComputeFieldConfig";
import { DateBucketConfig } from "./DateBucketConfig";
import { DedupeConfig } from "./DedupeConfig";
import { ExtractHeadingsConfig } from "./ExtractHeadingsConfig";
import { FillNullConfig } from "./FillNullConfig";
import { FilterConfig } from "./FilterConfig";
import { LimitConfig } from "./LimitConfig";
import { LookupConfig } from "./LookupConfig";
import { PivotConfig } from "./PivotConfig";
import { RenameFieldsConfig } from "./RenameFieldsConfig";
import { SortConfig } from "./SortConfig";
import { SelectFieldsConfig } from "./SelectFieldsConfig";
import { SplitTextConfig } from "./SplitTextConfig";
import { StepSchemaDiffChips } from "./StepSchemaDiffChips";
import { StringOpsConfig } from "./StringOpsConfig";
import { UnionConfig } from "./UnionConfig";
import { UnpivotConfig } from "./UnpivotConfig";
import { WindowConfig } from "./WindowConfig";

// HEL-404 — persistent per-user "preview open" preference. One global key
// (not per-step, see design.md Decision 3): the last explicit open/hide
// choice becomes the default for every StepCard, so expanding any card
// auto-opens its preview once the user has opted in. Follows theme.ts's
// storage-key + read-at-init precedent; the try/catch guard here is our own
// hardening (theme.ts only guards `typeof window`).
const PREVIEW_OPEN_STORAGE_KEY = "helio-step-preview-open";

/** 500ms > the 300ms analyze debounce in PipelineDetailPage, so the analyze
 *  round-trip and any config-PATCH burst settle first (design.md Decision 2). */
const PREVIEW_REFRESH_DEBOUNCE_MS = 500;

function readStoredPreviewOpen(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(PREVIEW_OPEN_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeStoredPreviewOpen(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREVIEW_OPEN_STORAGE_KEY, value ? "true" : "false");
  } catch {
    // Storage unavailable (private browsing, quota, disabled) — the
    // in-memory preview state still works for the current session.
  }
}

interface StepCardProps {
  step: Step;
  pipelineId: string;
  onRemove: (id: string) => void;
  /** Column names from the analyze endpoint's inputSchema for this step — used by SelectFieldsConfig/RenameFieldsConfig/CastFieldsConfig. */
  analyzeColumns: string[];
  /** Full schema fields from the analyze endpoint's inputSchema — used by FilterConfig for type-aware value input. */
  analyzeSchema: SchemaField[];
  /** HEL-404 — this step's output schema (name + type) from the analyze endpoint,
   *  rendered inline in the preview tray alongside the sample rows. Empty when
   *  analyze data for the step is unavailable (pending/failed/unknown step id). */
  analyzeOutputSchema: SchemaField[];
  /** This step's analyze-time `validationError`, if any (currently only rendered by
   *  the "compute" op's editor — see `ComputeFieldConfig`). */
  validationError?: string;
  /** Called after a successful config PATCH so the parent can keep step.config in sync. */
  onConfigChange: (stepId: string, config: PipelineStepConfig) => void;
  /** Output row count from the last run, if available. Null hides the chip. */
  rowCount: number | null;
}

export function StepCard({
  step,
  pipelineId,
  onRemove,
  analyzeColumns,
  analyzeSchema,
  analyzeOutputSchema,
  validationError,
  onConfigChange,
  rowCount,
}: StepCardProps) {
  const [expanded, setExpanded] = useState(false);

  // Preview state (component-local, transient rows/loading/error; previewOpen
  // is the one piece that persists — see PREVIEW_OPEN_STORAGE_KEY above).
  const [previewOpen, setPreviewOpen] = useState<boolean>(() => readStoredPreviewOpen());
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // HEL-404 — tracks the config fingerprint the preview was last fetched for.
  // `null` means "not fetched since preview last activated" (fresh open or
  // just-expanded card): fetch immediately, no debounce. A non-null value
  // that differs from the current fingerprint means the config changed while
  // the preview was active: debounce the re-fetch. Resets to `null` whenever
  // the preview deactivates (hidden or card collapsed) so reopening always
  // fetches fresh.
  const lastFetchedFingerprint = useRef<string | null>(null);
  const configFingerprint = JSON.stringify(step.config);

  useEffect(() => {
    const active = expanded && previewOpen;
    if (!active) {
      lastFetchedFingerprint.current = null;
      return;
    }

    async function runFetch() {
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const result: StepPreviewResponse = await fetchStepPreview(pipelineId, step.id);
        setPreviewRows(result.rows);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Preview failed";
        setPreviewError(message);
      } finally {
        setPreviewLoading(false);
      }
    }

    if (lastFetchedFingerprint.current === null) {
      // Activation: fetch immediately, no debounce.
      lastFetchedFingerprint.current = configFingerprint;
      void runFetch();
      return;
    }

    if (lastFetchedFingerprint.current === configFingerprint) {
      // Already fetched for this config — nothing changed.
      return;
    }

    // Config changed while active: debounce the re-fetch so a PATCH burst
    // (and the analyze round-trip that feeds the schema strip) settles first.
    const handle = window.setTimeout(() => {
      lastFetchedFingerprint.current = configFingerprint;
      void runFetch();
    }, PREVIEW_REFRESH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [expanded, previewOpen, pipelineId, step.id, configFingerprint]);

  function handlePreviewToggle() {
    setPreviewOpen((prev) => {
      const next = !prev;
      writeStoredPreviewOpen(next);
      return next;
    });
  }

  function handleHeaderClick() {
    if (!expanded) {
      // Collapsed → expanded transition: re-sync from localStorage. All
      // StepCards mount unconditionally (only the body is gated on
      // `expanded`), so a mount-time-only read would miss a preference
      // change a sibling card made earlier in the same session.
      setPreviewOpen(readStoredPreviewOpen());
    }
    setExpanded((prev) => !prev);
  }

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
  } = useStepCardState(step, onConfigChange);

  return (
    <div
      className={`pipeline-detail-page__step-card${expanded ? " pipeline-detail-page__step-card--expanded" : ""}`}
    >
      <button
        type="button"
        className="pipeline-detail-page__step-card-header"
        onClick={handleHeaderClick}
        aria-expanded={expanded}
      >
        <span className="pipeline-detail-page__step-card-icon" aria-hidden="true">
          <FontAwesomeIcon icon={step.opType.icon} />
        </span>
        <span className="pipeline-detail-page__step-card-label">{step.label}</span>
        {rowCount !== null && (
          <span className="pipeline-detail-page__step-card-count">
            {rowCount.toLocaleString()} rows
          </span>
        )}
        <span
          className={`pipeline-detail-page__step-card-chevron${expanded ? " pipeline-detail-page__step-card-chevron--open" : ""}`}
          aria-hidden="true"
        >
          ▾
        </span>
      </button>

      {expanded && (
        <div className="pipeline-detail-page__step-card-body">
          <StepSchemaDiffChips
            input={analyzeSchema}
            output={analyzeOutputSchema}
            renames={step.opType.id === "rename" ? renamesOf(step) : undefined}
          />
          {step.opType.id === "select" ? (
            <SelectFieldsConfig
              columns={analyzeColumns}
              selectedFields={selectedFields}
              onToggle={onFieldToggle}
            />
          ) : step.opType.id === "rename" ? (
            <RenameFieldsConfig
              columns={analyzeColumns}
              renames={renames}
              onChange={onRenameChange}
            />
          ) : step.opType.id === "cast" ? (
            <CastFieldsConfig columns={analyzeColumns} casts={casts} onChange={onCastChange} />
          ) : step.opType.id === "filter" ? (
            <FilterConfig
              config={filterConfig}
              analyzeSchema={analyzeSchema}
              onChange={onFilterChange}
            />
          ) : step.opType.id === "compute" ? (
            <ComputeFieldConfig
              config={computeConfig}
              analyzeColumns={analyzeColumns}
              validationError={validationError}
              onChange={onComputeChange}
            />
          ) : step.opType.id === "aggregate" ? (
            <AggregateConfig
              config={aggregateConfig}
              analyzeSchema={analyzeSchema}
              analyzeColumns={analyzeColumns}
              onChange={onAggregateChange}
            />
          ) : step.opType.id === "limit" ? (
            <LimitConfig count={limitCount} onChange={onLimitChange} />
          ) : step.opType.id === "sort" ? (
            <SortConfig sortBy={sortConfig} columns={analyzeColumns} onChange={onSortChange} />
          ) : step.opType.id === "splittext" ? (
            <SplitTextConfig
              config={splitTextConfig}
              analyzeSchema={analyzeSchema}
              onChange={onSplitTextChange}
            />
          ) : step.opType.id === "extractheadings" ? (
            <ExtractHeadingsConfig
              config={extractHeadingsConfig}
              analyzeSchema={analyzeSchema}
              onChange={onExtractHeadingsChange}
            />
          ) : step.opType.id === "chunkbytokencount" ? (
            <ChunkByTokenCountConfig
              config={chunkByTokenCountConfig}
              analyzeSchema={analyzeSchema}
              onChange={onChunkByTokenCountChange}
            />
          ) : step.opType.id === "datebucket" ? (
            <DateBucketConfig
              config={dateBucketConfig}
              analyzeColumns={analyzeColumns}
              onChange={onDateBucketChange}
            />
          ) : step.opType.id === "pivot" ? (
            <PivotConfig
              config={pivotConfig}
              analyzeSchema={analyzeSchema}
              analyzeColumns={analyzeColumns}
              onChange={onPivotChange}
            />
          ) : step.opType.id === "window" ? (
            <WindowConfig
              config={windowConfig}
              analyzeSchema={analyzeSchema}
              analyzeColumns={analyzeColumns}
              onChange={onWindowChange}
            />
          ) : step.opType.id === "unpivot" ? (
            <UnpivotConfig
              config={unpivotConfig}
              analyzeSchema={analyzeSchema}
              onChange={onUnpivotChange}
            />
          ) : step.opType.id === "dedupe" ? (
            <DedupeConfig
              config={dedupeConfig}
              analyzeColumns={analyzeColumns}
              onChange={onDedupeChange}
            />
          ) : step.opType.id === "fillnull" ? (
            <FillNullConfig
              config={fillNullConfig}
              analyzeColumns={analyzeColumns}
              onChange={onFillNullChange}
            />
          ) : step.opType.id === "stringops" ? (
            <StringOpsConfig
              config={stringOpsConfig}
              analyzeSchema={analyzeSchema}
              analyzeColumns={analyzeColumns}
              onChange={onStringOpsChange}
            />
          ) : step.opType.id === "union" ? (
            <UnionConfig config={unionConfig} onChange={onUnionChange} />
          ) : step.opType.id === "lookup" ? (
            <LookupConfig
              config={lookupConfig}
              analyzeSchema={analyzeSchema}
              onChange={onLookupChange}
            />
          ) : step.opType.id === "assert" ? (
            <AssertConfig
              config={assertConfig}
              analyzeSchema={analyzeSchema}
              onChange={onAssertChange}
            />
          ) : (
            <p className="pipeline-detail-page__step-card-desc">
              Configure this {step.opType.label.toLowerCase()} step.
            </p>
          )}
          <div className="pipeline-detail-page__step-card-actions">
            <button
              type="button"
              className="pipeline-detail-page__step-card-preview-btn"
              onClick={handlePreviewToggle}
              aria-expanded={previewOpen}
            >
              {previewOpen ? "Hide preview" : "Preview data"}
            </button>
            <button
              type="button"
              className="pipeline-detail-page__step-card-remove-btn"
              onClick={() => onRemove(step.id)}
            >
              Remove step
            </button>
          </div>

          {previewOpen && (
            <div className="pipeline-detail-page__step-preview">
              {analyzeOutputSchema.length > 0 && (
                <div
                  className="pipeline-detail-page__step-preview-schema"
                  aria-label="Output schema"
                >
                  {analyzeOutputSchema.map((field) => (
                    <span
                      key={field.name}
                      className="pipeline-detail-page__step-preview-schema-chip"
                    >
                      {field.name}
                      <span className="pipeline-detail-page__step-preview-schema-chip-type">
                        : {field.type}
                      </span>
                    </span>
                  ))}
                </div>
              )}
              {previewLoading ? (
                <p className="pipeline-detail-page__step-preview-loading">Loading preview…</p>
              ) : previewError !== null ? (
                <p className="pipeline-detail-page__step-preview-error" role="alert">
                  {previewError}
                </p>
              ) : (
                <DataGrid variant="preview" rows={previewRows} emptyText="No rows to preview." />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
