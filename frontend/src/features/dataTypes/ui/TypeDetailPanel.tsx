import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import "./TypeDetailPanel.css";
import {
  fetchAssertionStatus,
  selectAssertionInvalid,
  updateDataType,
} from "../state/dataTypesSlice";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { fetchDataTypeRows } from "../services/dataTypeService";
import {
  classifyRequestError,
  type RequestErrorKind,
} from "../../../services/classifyRequestError";
import type { ComputedField, DataType, DataTypeField } from "../types/dataType";
import { ComputedFieldsEditor } from "../../pipelines/ui/computedFields/ComputedFieldsEditor";
import { DataGrid, Select, TextField } from "../../../shared/ui/index";
import { InlineError } from "../../../shared/chrome/InlineError";

interface TypeDetailPanelProps {
  dataType: DataType;
}

interface EditableField extends DataTypeField {
  displayName: string;
  dataType: string;
}

export function TypeDetailPanel({ dataType }: TypeDetailPanelProps) {
  const dispatch = useAppDispatch();
  const [name, setName] = useState(dataType.name);
  const [fields, setFields] = useState<EditableField[]>(dataType.fields.map((f) => ({ ...f })));
  const [computedFields, setComputedFields] = useState<ComputedField[]>(
    dataType.computedFields ?? [],
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewErrorKind, setPreviewErrorKind] = useState<RequestErrorKind | null>(null);

  // HEL-576/F-182: per-type assertion/rule-validity status, same cache PanelCard
  // already reads via `selectAssertionInvalid` — dispatching here (deduped by
  // the slice's `condition`) means N surfaces bound to the same DataType share
  // one request.
  const isDataInvalid = useAppSelector((state) => selectAssertionInvalid(state, dataType.id));
  useEffect(() => {
    void dispatch(fetchAssertionStatus(dataType.id));
  }, [dispatch, dataType.id]);

  // F-076: monotonic request token so an out-of-order (superseded) preview
  // response can never overwrite a newer one's rows/error — guards a rapid
  // double Reload-click, not just a dataType switch (the latter now also
  // remounts this whole component via `TypeRegistryBrowser`'s `key` prop,
  // per F-001).
  const previewRequestIdRef = useRef(0);

  const handlePreview = useCallback(async () => {
    const requestId = ++previewRequestIdRef.current;
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewErrorKind(null);
    try {
      const result = await fetchDataTypeRows(dataType.id);
      if (previewRequestIdRef.current !== requestId) return;
      setPreviewRows(result.rows);
    } catch (err) {
      if (previewRequestIdRef.current !== requestId) return;
      const classified = classifyRequestError(err, "Failed to fetch preview.");
      setPreviewError(classified.message);
      setPreviewErrorKind(classified.kind);
      setPreviewRows(null);
    } finally {
      if (previewRequestIdRef.current === requestId) setPreviewLoading(false);
    }
  }, [dataType.id]);

  // Auto-load the preview when the user switches to a different data type.
  // Re-runs are still manual via the Reload button.
  useEffect(() => {
    void handlePreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataType.id]);

  function handleFieldChange(index: number, key: keyof EditableField, value: string | boolean) {
    setSaved(false);
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, [key]: value } : f)));
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);

    const result = await dispatch(
      updateDataType({
        id: dataType.id,
        name: name.trim() || dataType.name,
        fields,
        computedFields,
      }),
    );
    if (updateDataType.rejected.match(result)) {
      setError(result.payload ?? "Failed to save changes.");
    } else {
      setSaved(true);
    }
    setIsSaving(false);
  }

  return (
    <div className="type-detail-panel">
      <div className="type-detail-panel__header">
        <input
          type="text"
          className="type-detail-panel__name-input"
          aria-label="Data type name"
          value={name}
          onChange={(e) => {
            setSaved(false);
            setName(e.target.value);
          }}
        />
      </div>

      <form onSubmit={(e) => void handleSave(e)}>
        <section className="type-detail-panel__schema" aria-label="Schema">
          <div className="type-detail-panel__schema-heading">
            <h4 className="type-detail-panel__section-title">Schema</h4>
            {isDataInvalid && (
              <span
                className="type-detail-panel__assertion-badge"
                title="The latest pipeline run for this type failed an assertion rule"
              >
                Invalid data
              </span>
            )}
          </div>
          <table className="type-detail-panel__table" aria-label={`Fields for ${dataType.name}`}>
            <thead>
              <tr>
                <th>Field name</th>
                <th>Display name</th>
                <th>Data type</th>
                <th>Nullable</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((field, index) => (
                <tr key={field.name}>
                  <td className="type-detail-panel__field-name">{field.name}</td>
                  <td>
                    <TextField
                      type="text"
                      aria-label={`Display name for ${field.name}`}
                      value={field.displayName}
                      onChange={(e) => handleFieldChange(index, "displayName", e.target.value)}
                    />
                  </td>
                  <td>
                    <Select
                      ariaLabel={`Data type for ${field.name}`}
                      value={field.dataType}
                      onChange={(v) => handleFieldChange(index, "dataType", v)}
                      options={[
                        { value: "string", label: "string" },
                        { value: "integer", label: "integer" },
                        { value: "float", label: "float" },
                        { value: "boolean", label: "boolean" },
                        { value: "timestamp", label: "timestamp" },
                        { value: "string-body", label: "string-body" },
                        { value: "binary-ref", label: "binary-ref" },
                      ]}
                    />
                  </td>
                  <td className="type-detail-panel__nullable-cell">
                    <input
                      type="checkbox"
                      aria-label={`Nullable for ${field.name}`}
                      checked={field.nullable}
                      onChange={(e) => handleFieldChange(index, "nullable", e.target.checked)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <ComputedFieldsEditor
            typeId={dataType.id}
            computedFields={computedFields}
            onChange={(cfs) => {
              setSaved(false);
              setComputedFields(cfs);
            }}
          />
        </section>

        {error && (
          <p className="type-detail-panel__error" role="alert">
            {error}
          </p>
        )}
        {saved && (
          <p className="type-detail-panel__saved" role="status">
            Changes saved.
          </p>
        )}

        <div className="type-detail-panel__actions">
          <button type="submit" className="type-detail-panel__save-btn" disabled={isSaving}>
            {isSaving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>

      <section className="type-detail-panel__preview" aria-label="Preview">
        <div className="type-detail-panel__preview-header">
          <h4 className="type-detail-panel__section-title">Preview</h4>
          <button
            type="button"
            className="type-detail-panel__preview-btn"
            onClick={() => void handlePreview()}
            disabled={previewLoading}
          >
            {previewLoading ? "Loading…" : previewRows !== null ? "Reload" : "Preview"}
          </button>
        </div>
        <InlineError
          error={previewError}
          variant="banner"
          kind={previewErrorKind ?? "error"}
          onRetry={() => void handlePreview()}
          retrying={previewLoading}
        />
        {previewRows !== null ? (
          <DataGrid
            variant="preview"
            rows={previewRows}
            emptyText="No rows have been written to this type yet. Run a pipeline that writes to this type to populate it."
          />
        ) : previewLoading ? (
          <p className="type-detail-panel__preview-empty">Loading preview…</p>
        ) : null}
      </section>
    </div>
  );
}
