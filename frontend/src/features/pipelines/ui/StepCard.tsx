// StepCard — one expandable card per pipeline step on the PipelineDetailPage.
// Owns the per-step editor surface (delegating to the kind-specific editors)
// and the local "preview data" panel. Per-op editor state + PATCH-on-change
// persistence live in `useStepCardState`.

import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

import { useStepCardState } from "../hooks/useStepCardState";
import { fetchStepPreview } from "../services/pipelineService";
import type { StepPreviewResponse } from "../services/pipelineService";
import type { PipelineStepConfig, SchemaField } from "../types/pipelineStep";
import type { Step } from "../types/step";
import { AggregateConfig } from "./AggregateConfig";
import { CastFieldsConfig } from "./CastFieldsConfig";
import { ComputeFieldConfig } from "./ComputeFieldConfig";
import { ExtractHeadingsConfig } from "./ExtractHeadingsConfig";
import { FilterConfig } from "./FilterConfig";
import { LimitConfig } from "./LimitConfig";
import { RenameFieldsConfig } from "./RenameFieldsConfig";
import { SortConfig } from "./SortConfig";
import { SelectFieldsConfig } from "./SelectFieldsConfig";
import { SplitTextConfig } from "./SplitTextConfig";

interface StepCardProps {
  step: Step;
  pipelineId: string;
  onRemove: (id: string) => void;
  /** Column names from the analyze endpoint's inputSchema for this step — used by SelectFieldsConfig/RenameFieldsConfig/CastFieldsConfig. */
  analyzeColumns: string[];
  /** Full schema fields from the analyze endpoint's inputSchema — used by FilterConfig for type-aware value input. */
  analyzeSchema: SchemaField[];
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
  validationError,
  onConfigChange,
  rowCount,
}: StepCardProps) {
  const [expanded, setExpanded] = useState(false);

  // Preview state (component-local, transient)
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  async function handlePreviewToggle() {
    if (previewOpen) {
      setPreviewOpen(false);
      return;
    }
    setPreviewOpen(true);
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
  } = useStepCardState(step, onConfigChange);

  return (
    <div
      className={`pipeline-detail-page__step-card${expanded ? " pipeline-detail-page__step-card--expanded" : ""}`}
    >
      <button
        type="button"
        className="pipeline-detail-page__step-card-header"
        onClick={() => setExpanded((v) => !v)}
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
          ) : (
            <>
              <p className="pipeline-detail-page__step-card-desc">
                Configure this {step.opType.label.toLowerCase()} step.
              </p>
              <div className="pipeline-detail-page__step-card-diff">
                <span className="pipeline-detail-page__step-card-diff-chip pipeline-detail-page__step-card-diff-chip--added">
                  + col_a
                </span>
                <span className="pipeline-detail-page__step-card-diff-chip pipeline-detail-page__step-card-diff-chip--removed">
                  − col_b
                </span>
                <span className="pipeline-detail-page__step-card-diff-chip pipeline-detail-page__step-card-diff-chip--changed">
                  ~ col_c
                </span>
              </div>
            </>
          )}
          <div className="pipeline-detail-page__step-card-actions">
            <button
              type="button"
              className="pipeline-detail-page__step-card-preview-btn"
              onClick={() => void handlePreviewToggle()}
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
              {previewLoading ? (
                <p className="pipeline-detail-page__step-preview-loading">Loading preview…</p>
              ) : previewError !== null ? (
                <p className="pipeline-detail-page__step-preview-error" role="alert">
                  {previewError}
                </p>
              ) : previewRows.length === 0 ? (
                <p className="pipeline-detail-page__step-preview-empty">No rows to preview.</p>
              ) : (
                <div className="pipeline-detail-page__step-preview-table-wrapper">
                  <table className="pipeline-detail-page__step-preview-table">
                    <thead>
                      <tr>
                        {Object.keys(previewRows[0]).map((col) => (
                          <th key={col} className="pipeline-detail-page__step-preview-th">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, i) => (
                        <tr key={i}>
                          {Object.values(row).map((cell, j) => (
                            <td key={j} className="pipeline-detail-page__step-preview-td">
                              {cell === null || cell === undefined ? "" : String(cell)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
