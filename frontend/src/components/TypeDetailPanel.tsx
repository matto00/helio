import { useState, type FormEvent } from "react";

import "./TypeDetailPanel.css";
import { updateDataType } from "../features/dataTypes/dataTypesSlice";
import { useAppDispatch } from "../hooks/reduxHooks";
import { fetchDataTypeRows } from "../services/dataTypeService";
import type { ComputedField, DataType, DataTypeField } from "../types/models";
import { ComputedFieldsEditor } from "./ComputedFieldsEditor";
import { PreviewTable } from "./PreviewTable";

interface TypeDetailPanelProps {
  dataType: DataType;
  onClose: () => void;
  /** Optional inline-delete affordance. When all four callbacks are set, the
   * header renders a Delete button that toggles a Confirm/Cancel pair. */
  confirmingDelete?: boolean;
  onDeleteRequest?: () => void;
  onDeleteConfirm?: () => void;
  onDeleteCancel?: () => void;
}

interface EditableField extends DataTypeField {
  displayName: string;
  dataType: string;
}

export function TypeDetailPanel({
  dataType,
  onClose,
  confirmingDelete = false,
  onDeleteRequest,
  onDeleteConfirm,
  onDeleteCancel,
}: TypeDetailPanelProps) {
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

  async function handlePreview() {
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
  }

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
        <div className="type-detail-panel__header-actions">
          <button
            type="button"
            className="type-detail-panel__preview-btn"
            onClick={() => void handlePreview()}
            disabled={previewLoading}
          >
            {previewLoading ? "Loading…" : "Preview"}
          </button>
          {onDeleteRequest !== undefined ? (
            confirmingDelete ? (
              <>
                <button
                  type="button"
                  className="type-detail-panel__delete-confirm-btn"
                  onClick={onDeleteConfirm}
                >
                  Confirm delete
                </button>
                <button
                  type="button"
                  className="type-detail-panel__delete-cancel-btn"
                  onClick={onDeleteCancel}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                className="type-detail-panel__delete-btn"
                onClick={onDeleteRequest}
              >
                Delete
              </button>
            )
          ) : null}
          <button
            type="button"
            className="type-detail-panel__close"
            aria-label={`Close ${dataType.name} detail`}
            onClick={onClose}
          >
            ✕
          </button>
        </div>
      </div>

      {previewError && (
        <p className="type-detail-panel__error" role="alert">
          {previewError}
        </p>
      )}
      {previewRows !== null && (
        <PreviewTable
          rows={previewRows}
          emptyText="No rows have been written to this type yet. Run a pipeline that writes to this type to populate it."
        />
      )}

      <form onSubmit={(e) => void handleSave(e)}>
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
                  <input
                    type="text"
                    className="type-detail-panel__cell-input"
                    aria-label={`Display name for ${field.name}`}
                    value={field.displayName}
                    onChange={(e) => handleFieldChange(index, "displayName", e.target.value)}
                  />
                </td>
                <td>
                  <select
                    className="type-detail-panel__cell-select"
                    aria-label={`Data type for ${field.name}`}
                    value={field.dataType}
                    onChange={(e) => handleFieldChange(index, "dataType", e.target.value)}
                  >
                    <option value="string">string</option>
                    <option value="integer">integer</option>
                    <option value="float">float</option>
                    <option value="boolean">boolean</option>
                    <option value="timestamp">timestamp</option>
                  </select>
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
    </div>
  );
}
