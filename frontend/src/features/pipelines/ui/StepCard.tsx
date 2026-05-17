// StepCard — one expandable card per pipeline step on the PipelineDetailPage.
// Owns the per-step editor surface (delegating to the kind-specific editors),
// the local "preview data" panel, and the PATCH-on-change persistence path.

import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

import {
  aggregateConfigOf,
  castsOf,
  computeConfigOf,
  filterConfigOf,
  limitCountOf,
  renamesOf,
  selectedFieldsOf,
  sortConfigOf,
} from "../state/stepNarrowing";
import { fetchStepPreview, updatePipelineStep } from "../services/pipelineService";
import type { StepPreviewResponse } from "../services/pipelineService";
import type { PipelineStepConfig, SchemaField } from "../types/pipelineStep";
import type { Step } from "../types/step";
import { AggregateConfig } from "./AggregateConfig";
import type { AggregateConfigValue } from "./AggregateConfig";
import { CastFieldsConfig } from "./CastFieldsConfig";
import { ComputeFieldConfig } from "./ComputeFieldConfig";
import type { ComputeConfigValue } from "./ComputeFieldConfig";
import { FilterConfig } from "./FilterConfig";
import type { FilterConfigValue } from "./FilterConfig";
import { LimitConfig } from "./LimitConfig";
import { RenameFieldsConfig } from "./RenameFieldsConfig";
import { SortConfig } from "./SortConfig";
import type { SortKey } from "./SortConfig";
import { SelectFieldsConfig } from "./SelectFieldsConfig";

interface StepCardProps {
  step: Step;
  pipelineId: string;
  onRemove: (id: string) => void;
  /** Column names from the analyze endpoint's inputSchema for this step — used by SelectFieldsConfig/RenameFieldsConfig/CastFieldsConfig. */
  analyzeColumns: string[];
  /** Full schema fields from the analyze endpoint's inputSchema — used by FilterConfig for type-aware value input. */
  analyzeSchema: SchemaField[];
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

  // Derived state: sync local editor state when the persisted config or
  // opType changes (during-render pattern). CS2c-3a: `step.config` is already
  // a typed object, so the narrowing helpers replace the per-render JSON
  // parsing the pre-CS2c-3a editor performed.
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

  function handleFieldToggle(field: string, checked: boolean) {
    const next = checked ? [...selectedFields, field] : selectedFields.filter((f) => f !== field);
    setSelectedFields(next);
    persist({ fields: next });
  }

  function handleRenameChange(field: string, newName: string) {
    const next = { ...renames };
    if (newName) next[field] = newName;
    else delete next[field];
    setRenames(next);
    persist({ renames: next });
  }

  function handleCastChange(field: string, targetType: string) {
    const next = { ...casts };
    if (targetType) next[field] = targetType;
    else delete next[field];
    setCasts(next);
    persist({ casts: next });
  }

  function handleFilterChange(newConfig: FilterConfigValue) {
    setFilterConfig(newConfig);
    persist({
      combinator: newConfig.combinator,
      conditions: newConfig.conditions,
    });
  }

  function handleComputeChange(newConfig: ComputeConfigValue) {
    setComputeConfig(newConfig);
    persist(newConfig);
  }

  function handleAggregateChange(newConfig: AggregateConfigValue) {
    setAggregateConfig(newConfig);
    persist(newConfig);
  }

  function handleLimitChange(newConfig: { count: number }) {
    setLimitCount(newConfig.count);
    persist(newConfig);
  }

  function handleSortChange(newConfig: { sortBy: SortKey[] }) {
    setSortConfig(newConfig.sortBy);
    persist(newConfig);
  }

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
              onToggle={handleFieldToggle}
            />
          ) : step.opType.id === "rename" ? (
            <RenameFieldsConfig
              columns={analyzeColumns}
              renames={renames}
              onChange={handleRenameChange}
            />
          ) : step.opType.id === "cast" ? (
            <CastFieldsConfig columns={analyzeColumns} casts={casts} onChange={handleCastChange} />
          ) : step.opType.id === "filter" ? (
            <FilterConfig
              config={filterConfig}
              analyzeSchema={analyzeSchema}
              onChange={handleFilterChange}
            />
          ) : step.opType.id === "compute" ? (
            <ComputeFieldConfig
              config={computeConfig}
              analyzeColumns={analyzeColumns}
              onChange={handleComputeChange}
            />
          ) : step.opType.id === "aggregate" ? (
            <AggregateConfig
              config={aggregateConfig}
              analyzeSchema={analyzeSchema}
              analyzeColumns={analyzeColumns}
              onChange={handleAggregateChange}
            />
          ) : step.opType.id === "limit" ? (
            <LimitConfig count={limitCount} onChange={handleLimitChange} />
          ) : step.opType.id === "sort" ? (
            <SortConfig sortBy={sortConfig} columns={analyzeColumns} onChange={handleSortChange} />
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
