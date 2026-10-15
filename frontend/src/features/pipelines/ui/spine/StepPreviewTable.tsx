// StepPreviewTable -- HEL-1579 (design.md D8): the rows after the selected step, under the focused editor.
// Header: "Rows after step <n>", the row count (mono), the step's schema-diff chips and the step's output
// schema chips (moved here from the footer; `OutputSchemaDisclosure` above the existing threshold).
// Columns carry their data type (from analyze) in the header. States: loading (skeleton rows), error
// (`role=alert`, the named `STEP_CONFIG_INVALID` reason as the card tray shows it), empty, a disabled step
// (rows pass through unchanged, no fetch) and a step still being created (no fetch). No "live" marker:
// DESIGN.md §11 reserves it for surfaces recomputed from a draft, which this ticket does not build.
//
// The component is keyed by the selected step id, so every selection mounts it fresh and fetches fresh.

import { useMemo } from "react";

import { DataGrid, Skeleton } from "../../../../shared/ui/index";
import type { ColumnDef } from "../../../../shared/ui/index";
import { SCHEMA_FIELD_VIEWER_SMALL_THRESHOLD } from "../../../../shared/ui/useSchemaFieldSearch";
import { useStepPreviewFetch } from "../../hooks/useStepPreviewFetch";
import { fetchStepPreview } from "../../services/pipelineService";
import type { InFlightDedupe } from "../../state/inFlightDedupe";
import { isTempStepId, renamesOf } from "../../state/stepNarrowing";
import type { SchemaField } from "../../types/pipelineStep";
import type { Step } from "../../types/step";
import { OutputSchemaDisclosure } from "../OutputSchemaDisclosure";
import { StepSchemaDiffChips } from "../StepSchemaDiffChips";
import "./StepPreviewTable.css";

interface StepPreviewTableProps {
  pipelineId: string;
  step: Step;
  /** 1-based number within the step's lane (the "step <n>" in the header). */
  stepNumber: number;
  /** The step's index in its lane, folded into the refetch fingerprint so a reorder refreshes. */
  stepIndex: number;
  /** One bit per step (HEL-412 Decision 8): toggling any step can change what this prefix executes. */
  enabledBits: string;
  analyzeSchema: SchemaField[];
  analyzeOutputSchema: SchemaField[];
  /** False while a created draft is still on the anchor-derived fallback schema (HEL-1340). */
  hasOwnAnalyze: boolean;
  isCreating: boolean;
  /** Page-scoped in-flight-only dedupe, keyed here by step id + config fingerprint (design.md D8). */
  dedupe: InFlightDedupe;
  /** Resolves once every pending step save has settled (design.md D8). */
  beforeFetch: () => Promise<void>;
}

export function StepPreviewTable({
  pipelineId,
  step,
  stepNumber,
  stepIndex,
  enabledBits,
  analyzeSchema,
  analyzeOutputSchema,
  hasOwnAnalyze,
  isCreating,
  dedupe,
  beforeFetch,
}: StepPreviewTableProps) {
  const isDraft = isTempStepId(step.id);
  const canFetch = step.enabled && !isCreating && !isDraft;
  const configFingerprint = `${stepIndex}:${enabledBits}:${JSON.stringify(step.config)}`;

  const { previewRows, previewRowCount, previewError } = useStepPreviewFetch({
    pipelineId,
    stepId: step.id,
    stepEnabled: step.enabled,
    active: canFetch,
    configFingerprint,
    fetcher: (pid, sid) =>
      dedupe.run(`${sid}:${configFingerprint}`, () => fetchStepPreview(pid, sid)),
    beforeFetch,
  });

  const columns = useMemo<ColumnDef[] | undefined>(
    () =>
      analyzeOutputSchema.length > 0
        ? analyzeOutputSchema.map((f) => ({ key: f.name, header: f.name, headerType: f.type }))
        : undefined,
    [analyzeOutputSchema],
  );

  const showDiff = !isDraft && hasOwnAnalyze;
  const countText =
    canFetch && previewRowCount !== null && previewError === null
      ? `${previewRowCount.toLocaleString()} ${previewRowCount === 1 ? "row" : "rows"}`
      : null;

  let body;
  if (!step.enabled) {
    body = <p className="step-preview__note">This step is off, so rows pass through unchanged.</p>;
  } else if (isCreating || isDraft) {
    body = <p className="step-preview__note">Saving step… rows appear once it is saved.</p>;
  } else if (previewError !== null) {
    body = (
      <p className="step-preview__error" role="alert">
        {previewError}
      </p>
    );
  } else if (previewRowCount === null) {
    // Never settled yet (including the render before the fetch effect starts): loading, not "empty".
    body = (
      <div className="step-preview__loading" role="status" aria-label="Loading preview">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} variant="line" />
        ))}
      </div>
    );
  } else {
    body = (
      <DataGrid
        variant="preview"
        density="condensed"
        className="step-preview__grid"
        rows={previewRows}
        columns={columns}
        emptyText="No rows to preview."
      />
    );
  }

  return (
    <section className="step-preview" aria-label={`Rows after step ${stepNumber}`}>
      <header className="step-preview__header">
        <h2 className="step-preview__title">Rows after step {stepNumber}</h2>
        {countText !== null && <span className="step-preview__count">{countText}</span>}
        {showDiff && (
          <StepSchemaDiffChips
            input={analyzeSchema}
            output={analyzeOutputSchema}
            renames={step.opType.id === "rename" ? renamesOf(step) : undefined}
          />
        )}
        {analyzeOutputSchema.length > 0 &&
          (analyzeOutputSchema.length <= SCHEMA_FIELD_VIEWER_SMALL_THRESHOLD ? (
            <span className="step-preview__schema" aria-label="Output schema">
              {analyzeOutputSchema.map((field) => (
                <span key={field.name} className="step-preview__schema-chip">
                  {field.name}
                </span>
              ))}
            </span>
          ) : (
            <OutputSchemaDisclosure fields={analyzeOutputSchema} />
          ))}
      </header>
      <div className="step-preview__body">{body}</div>
    </section>
  );
}
