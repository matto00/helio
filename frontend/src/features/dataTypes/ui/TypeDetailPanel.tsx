import { useCallback, useEffect, useState, type FormEvent } from "react";

import "./TypeDetailPanel.css";
import { updateDataType } from "../state/dataTypesSlice";
import { useAppDispatch } from "../../../hooks/reduxHooks";
import { fetchDataTypeRows } from "../services/dataTypeService";
import type { ComputedField, DataType, DataTypeField } from "../../../types/models";
import { ComputedFieldsEditor } from "../../../components/ComputedFieldsEditor";
import { PreviewTable } from "../../../components/PreviewTable";
import { Select, TextField } from "../../../shared/ui/index";

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

  const handlePreview = useCallback(async () => {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const result = await fetchDataTypeRows(dataType.id);
      setPreviewRows(result.rows);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Failed to fetch preview.");
      setPreviewRows(null);
    } finally {
      setPreviewLoading(false);
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
          <h4 className="type-detail-panel__section-title">Schema</h4>
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
        {previewError && (
          <p className="type-detail-panel__error" role="alert">
            {previewError}
          </p>
        )}
        {previewRows !== null ? (
          <PreviewTable
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
