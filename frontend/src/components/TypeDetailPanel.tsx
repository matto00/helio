import { useState, type FormEvent } from "react";

import "./TypeDetailPanel.css";
import { updateDataType } from "../features/dataTypes/dataTypesSlice";
import { useAppDispatch } from "../hooks/reduxHooks";
import type { ComputedField, DataType, DataTypeField } from "../types/models";
import { ComputedFieldsEditor } from "./ComputedFieldsEditor";

interface TypeDetailPanelProps {
  dataType: DataType;
  onClose: () => void;
}

interface EditableField extends DataTypeField {
  displayName: string;
  dataType: string;
}

export function TypeDetailPanel({ dataType, onClose }: TypeDetailPanelProps) {
  const dispatch = useAppDispatch();
  const [name, setName] = useState(dataType.name);
  const [fields, setFields] = useState<EditableField[]>(dataType.fields.map((f) => ({ ...f })));
  const [computedFields, setComputedFields] = useState<ComputedField[]>(
    dataType.computedFields ?? [],
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

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
        <button
          type="button"
          className="type-detail-panel__close"
          aria-label={`Close ${dataType.name} detail`}
          onClick={onClose}
        >
          ✕
        </button>
      </div>

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
