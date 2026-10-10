// StepCardPreviewTray — the inline "preview data" tray of an expanded step card, split out of
// StepCard.tsx (HEL-1465). Calls no hooks; `StepCard` owns the `previewOpen && step.enabled` guard.

import { DataGrid } from "../../../shared/ui/index";
import type { SchemaField } from "../types/pipelineStep";

interface StepCardPreviewTrayProps {
  analyzeOutputSchema: SchemaField[];
  previewLoading: boolean;
  previewError: string | null;
  previewRows: Record<string, unknown>[];
}

export function StepCardPreviewTray({
  analyzeOutputSchema,
  previewLoading,
  previewError,
  previewRows,
}: StepCardPreviewTrayProps) {
  return (
    <div className="pipeline-detail-page__step-preview">
      {analyzeOutputSchema.length > 0 && (
        <div className="pipeline-detail-page__step-preview-schema" aria-label="Output schema">
          {analyzeOutputSchema.map((field) => (
            <span key={field.name} className="pipeline-detail-page__step-preview-schema-chip">
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
  );
}
