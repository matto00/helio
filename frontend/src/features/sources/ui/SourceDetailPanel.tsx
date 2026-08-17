import { Pencil } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import "./SourceDetailPanel.css";
import { fetchCsvPreview, fetchRestPreview } from "../services/dataSourceService";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { updateSource } from "../state/sourcesSlice";
import type { DataSource, DataSourceKind } from "../types/dataSource";
import { InlineError } from "../../../shared/chrome/InlineError";
import { DataGrid, TextField } from "../../../shared/ui/index";
import { EmptySchemaAffordance } from "./EmptySchemaAffordance";

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
    case "text":
      return "Text/Markdown";
    case "pdf":
      return "PDF";
    case "image":
      return "Image";
  }
}

export function SourceDetailPanel({ source }: SourceDetailPanelProps) {
  const dispatch = useAppDispatch();
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[] | null>(null);
  const [previewHeaders, setPreviewHeaders] = useState<string[] | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // F-070: rename exists end-to-end in state/API (`updateSource`) but had no
  // UI trigger anywhere in this feature. Wired here rather than on the
  // sidebar's SidebarItemList (the other option the finding names) because
  // that file isn't owned by this package. Mirrors SidebarItemList's own
  // rename affordance: Enter commits, Escape/blur cancels, a failed save
  // stays in edit mode and shows the rejection message inline.
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameInvalid, setRenameInvalid] = useState(false);
  const [renameStatus, setRenameStatus] = useState<"idle" | "saving">("idle");
  const [renameError, setRenameError] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Selecting a different source while mid-rename must not leave a stale
  // edit open (and definitely must not later commit the wrong source's
  // typed value).
  useEffect(() => {
    setIsRenaming(false);
    setRenameError(null);
  }, [source.id]);

  useEffect(() => {
    if (isRenaming && renameStatus === "idle") {
      renameInputRef.current?.focus({ preventScroll: true });
      renameInputRef.current?.select();
    }
  }, [isRenaming, renameStatus]);

  function startRename() {
    setIsRenaming(true);
    setRenameValue(source.name);
    setRenameInvalid(false);
    setRenameStatus("idle");
    setRenameError(null);
  }

  function cancelRename() {
    setIsRenaming(false);
    setRenameInvalid(false);
    setRenameStatus("idle");
    setRenameError(null);
  }

  async function commitRename() {
    const trimmed = renameValue.trim();
    if (trimmed.length === 0) {
      setRenameInvalid(true);
      return;
    }
    if (trimmed === source.name) {
      cancelRename();
      return;
    }
    setRenameStatus("saving");
    setRenameError(null);
    try {
      await dispatch(updateSource({ id: source.id, name: trimmed })).unwrap();
      cancelRename();
    } catch (err) {
      setRenameStatus("idle");
      setRenameError(typeof err === "string" ? err : "Failed to rename source.");
    }
  }

  function handleRenameKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void commitRename();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelRename();
    }
  }

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
          {isRenaming ? (
            <TextField
              ref={renameInputRef}
              className="source-detail-panel__rename-input"
              type="text"
              value={renameValue}
              disabled={renameStatus === "saving"}
              aria-label={`Rename ${source.name}`}
              aria-invalid={renameInvalid ? true : undefined}
              onChange={(event) => {
                setRenameValue(event.target.value);
                setRenameInvalid(false);
              }}
              onKeyDown={handleRenameKeyDown}
              onBlur={() => {
                // A disabled input (mid-save) can't hold focus, so React
                // blurs it as a side effect of the save itself — that must
                // not be treated as the user cancelling out.
                if (renameStatus === "saving") return;
                cancelRename();
              }}
            />
          ) : (
            <>
              {/* F-179: long names truncate (CSS ellipsis); `title` restores
                  the full name on hover. */}
              <h3 className="source-detail-panel__name" title={source.name}>
                {source.name}
              </h3>
              <button
                type="button"
                className="source-detail-panel__rename-btn"
                aria-label={`Rename ${source.name}`}
                onClick={startRename}
              >
                <Pencil size={13} aria-hidden="true" />
              </button>
            </>
          )}
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
      {isRenaming ? <InlineError error={renameError} variant="banner" /> : null}

      {relatedType !== undefined && relatedType.fields.length > 0 ? (
        <section className="source-detail-panel__schema" aria-label="Inferred schema">
          <h4 className="source-detail-panel__section-title">Schema</h4>
          <div className="source-detail-panel__schema-table-wrapper">
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
          </div>
        </section>
      ) : (
        <EmptySchemaAffordance source={source} />
      )}

      <section className="source-detail-panel__preview" aria-label="Preview">
        <h4 className="source-detail-panel__section-title">Preview</h4>
        <InlineError error={error} variant="banner" />
        {previewRows !== null ? (
          <DataGrid
            variant="preview"
            rows={previewRows}
            columns={previewHeaders?.map((h) => ({ key: h }))}
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
