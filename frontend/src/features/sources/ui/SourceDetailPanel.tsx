import { useState } from "react";

import "./SourceDetailPanel.css";
import { fetchCsvPreview, fetchRestPreview } from "../services/dataSourceService";
import { useAppSelector } from "../../../hooks/reduxHooks";
import type { DataSource, DataSourceKind } from "../../../types/models";
import { PreviewTable } from "../../panels/ui/PreviewTable";

interface SourceDetailPanelProps {
  source: DataSource;
}

function labelForKind(kind: DataSourceKind): string {
  switch (kind) {
    case "rest_api":
      return "REST API";
    case "csv":
      return "CSV";
    case "static":
      return "Static";
    case "sql":
      return "SQL";
  }
}

export function SourceDetailPanel({ source }: SourceDetailPanelProps) {
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[] | null>(null);
  const [previewHeaders, setPreviewHeaders] = useState<string[] | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pull the DataType inferred from this source (created automatically when the
  // source is added; carries field/column metadata). Showing its schema lets
  // the user inspect the inferred columns without running a preview first.
  const relatedType = useAppSelector((state) =>
    state.dataTypes.items.find((dt) => dt.sourceId === source.id),
  );

  async function handlePreview() {
    setIsLoading(true);
    setError(null);
    try {
      if (source.type === "csv" || source.type === "static") {
        const result = await fetchCsvPreview(source.id, 25);
        setPreviewHeaders(result.headers);
        setPreviewRows(
          result.rows.map((row) =>
            Object.fromEntries(result.headers.map((h, i) => [h, row[i] ?? null])),
          ),
        );
      } else if (source.type === "rest_api") {
        const result = await fetchRestPreview(source.id);
        setPreviewHeaders(undefined);
        setPreviewRows(result.rows);
      } else {
        setError(`Preview is not supported for ${labelForKind(source.type)} sources.`);
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
          <span className="source-detail-panel__type">{labelForKind(source.type)}</span>
        </div>
        <div className="source-detail-panel__header-actions">
          <button
            type="button"
            className="source-detail-panel__preview-btn"
            onClick={() => void handlePreview()}
            disabled={isLoading}
          >
            {isLoading ? "Loading…" : previewRows !== null ? "Reload" : "Preview"}
          </button>
        </div>
      </div>

      {relatedType !== undefined && relatedType.fields.length > 0 ? (
        <section className="source-detail-panel__schema" aria-label="Inferred schema">
          <h4 className="source-detail-panel__section-title">Schema</h4>
          <table className="source-detail-panel__schema-table">
            <thead>
              <tr>
                <th>Field</th>
                <th>Type</th>
                <th>Nullable</th>
              </tr>
            </thead>
            <tbody>
              {relatedType.fields.map((field) => (
                <tr key={field.name}>
                  <td className="source-detail-panel__schema-field-name">{field.name}</td>
                  <td>{field.dataType}</td>
                  <td>{field.nullable ? "yes" : "no"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section className="source-detail-panel__preview" aria-label="Preview">
        <h4 className="source-detail-panel__section-title">Preview</h4>
        {error && (
          <p className="source-detail-panel__error" role="alert">
            {error}
          </p>
        )}
        {previewRows !== null ? (
          <PreviewTable
            rows={previewRows}
            headers={previewHeaders}
            emptyText="Source returned no rows."
          />
        ) : (
          <p className="source-detail-panel__preview-empty">
            Click <strong>Preview</strong> to load a sample of this source.
          </p>
        )}
      </section>
    </div>
  );
}
