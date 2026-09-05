// Editable inferred-fields table shown on the AddSourceModal preview step.
// Lets the user tweak display name, data type, and nullability for each
// field inferred from the REST or CSV source before persisting.
//
// Extracted from AddSourceModal.tsx in CS3 cycle 2 (behavior-preserving).

import type { InferredField } from "../types/dataSource";
import { Select } from "../../../shared/ui/Select";
import { TextField } from "../../../shared/ui/TextField";

export interface EditableField extends InferredField {
  displayName: string;
  dataType: string;
}

interface InferredFieldsTableProps {
  fields: EditableField[];
  onFieldChange: (index: number, key: keyof EditableField, value: string | boolean) => void;
  /** HEL-893 design D3: a CSV column always materializes as `String` — the row loader never
   *  casts it. Passing `"csv"` disables the data-type editor entirely, so the UI cannot re-create
   *  the declared-vs-runtime defect this change removes in one click; the API rejects a non-string
   *  CSV override for the same reason if this control is ever bypassed. */
  sourceKind?: "csv" | "rest_api";
}

export function InferredFieldsTable({
  fields,
  onFieldChange,
  sourceKind,
}: InferredFieldsTableProps) {
  if (fields.length === 0) {
    return <p className="add-source-modal__empty">No fields were detected.</p>;
  }
  const dataTypeLocked = sourceKind === "csv";
  return (
    <>
      <table className="add-source-modal__fields-table" aria-label="Inferred fields">
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
              <td className="add-source-modal__field-name">{field.name}</td>
              <td>
                <TextField
                  type="text"
                  aria-label={`Display name for ${field.name}`}
                  value={field.displayName}
                  onChange={(e) => onFieldChange(index, "displayName", e.target.value)}
                />
              </td>
              <td>
                <Select
                  ariaLabel={`Data type for ${field.name}`}
                  value={field.dataType}
                  onChange={(v) => onFieldChange(index, "dataType", v)}
                  disabled={dataTypeLocked}
                  options={[
                    { value: "string", label: "string" },
                    { value: "integer", label: "integer" },
                    { value: "float", label: "float" },
                    { value: "boolean", label: "boolean" },
                    { value: "timestamp", label: "timestamp" },
                  ]}
                />
              </td>
              <td className="add-source-modal__nullable-cell">
                <input
                  type="checkbox"
                  aria-label={`Nullable for ${field.name}`}
                  checked={field.nullable}
                  onChange={(e) => onFieldChange(index, "nullable", e.target.checked)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {dataTypeLocked ? (
        <p className="add-source-modal__hint">
          CSV columns always load as string. To get numbers, booleans, or timestamps, add a{" "}
          <strong>cast</strong> step in the pipeline after this source.
        </p>
      ) : null}
    </>
  );
}
