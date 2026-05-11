import { useState } from "react";

import "./SourceDetailPanel.css";
import { fetchCsvPreview, fetchRestPreview } from "../services/dataSourceService";
import type { DataSource } from "../types/models";
import { PreviewTable } from "./PreviewTable";

interface SourceDetailPanelProps {
  source: DataSource;
  onDelete?: () => void;
}

function labelForSourceType(sourceType: string): string {
  if (sourceType === "rest_api") return "REST API";
  if (sourceType === "csv") return "CSV";
  if (sourceType === "static") return "Static";
  if (sourceType === "sql") return "SQL";
  return sourceType;
}

export function SourceDetailPanel({ source, onDelete }: SourceDetailPanelProps) {
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[] | null>(null);
  const [previewHeaders, setPreviewHeaders] = useState<string[] | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function handlePreview() {
    setIsLoading(true);
    setError(null);
    try {
      if (source.sourceType === "csv") {
        const result = await fetchCsvPreview(source.id, 25);
        setPreviewHeaders(result.headers);
        setPreviewRows(
          result.rows.map((row) =>
            Object.fromEntries(result.headers.map((h, i) => [h, row[i] ?? null])),
          ),
        );
      } else if (source.sourceType === "static") {
        const result = await fetchCsvPreview(source.id, 25);
        setPreviewHeaders(result.headers);
        setPreviewRows(
          result.rows.map((row) =>
            Object.fromEntries(result.headers.map((h, i) => [h, row[i] ?? null])),
          ),
        );
      } else if (source.sourceType === "rest_api") {
        const result = await fetchRestPreview(source.id);
        setPreviewHeaders(undefined);
        setPreviewRows(result.rows);
      } else {
        setError(`Preview is not supported for ${labelForSourceType(source.sourceType)} sources.`);
        setPreviewRows(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch preview.");
      setPreviewRows(null);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="source-detail-panel">
      <div className="source-detail-panel__header">
        <div className="source-detail-panel__title-row">
          <h3 className="source-detail-panel__name">{source.name}</h3>
          <span className="source-detail-panel__type">{labelForSourceType(source.sourceType)}</span>
        </div>
        <div className="source-detail-panel__header-actions">
          <button
            type="button"
            className="source-detail-panel__preview-btn"
            onClick={() => void handlePreview()}
            disabled={isLoading}
          >
            {isLoading ? "Loading…" : "Preview"}
          </button>
          {onDelete !== undefined ? (
            confirmingDelete ? (
              <>
                <button
                  type="button"
                  className="source-detail-panel__delete-confirm-btn"
                  onClick={() => {
                    onDelete();
                    setConfirmingDelete(false);
                  }}
                >
                  Confirm delete
                </button>
                <button
                  type="button"
                  className="source-detail-panel__delete-cancel-btn"
                  onClick={() => setConfirmingDelete(false)}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                className="source-detail-panel__delete-btn"
                onClick={() => setConfirmingDelete(true)}
              >
                Delete
              </button>
            )
          ) : null}
        </div>
      </div>

      {error && (
        <p className="source-detail-panel__error" role="alert">
          {error}
        </p>
      )}

      {previewRows !== null && (
        <PreviewTable
          rows={previewRows}
          headers={previewHeaders}
          emptyText="Source returned no rows."
        />
      )}
    </div>
  );
}
