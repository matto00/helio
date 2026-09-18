// HEL-1084 design.md D3/D7 — typed-value option rows for a `select` control field.
// One typed input per option (number input for numeric, checkbox for boolean, date for
// timestamp, text otherwise) with add/remove.

import { IconButton, TextField, Toggle } from "../../../../shared/ui/index";
import { Plus, Trash2 } from "lucide-react";
import type { DatasetFieldType } from "../../../sources/types/dataSource";
import { parseTypedValue } from "../../state/formConfigValidation";

interface FormOptionsEditorProps {
  fieldName: string;
  fieldType: DatasetFieldType;
  options: unknown[];
  onChange: (options: unknown[]) => void;
}

function optionInputType(fieldType: DatasetFieldType): "text" | "number" {
  return fieldType === "integer" || fieldType === "float" ? "number" : "text";
}

export function FormOptionsEditor({
  fieldName,
  fieldType,
  options,
  onChange,
}: FormOptionsEditorProps) {
  function updateAt(index: number, value: unknown) {
    onChange(options.map((o, i) => (i === index ? value : o)));
  }

  function removeAt(index: number) {
    onChange(options.filter((_, i) => i !== index));
  }

  function addOption() {
    onChange([...options, fieldType === "boolean" ? false : ""]);
  }

  return (
    <div className="form-editor__options">
      {options.map((option, index) => (
        <div className="form-editor__option-row" key={index}>
          {fieldType === "boolean" ? (
            <Toggle
              checked={option === true}
              onChange={(checked) => updateAt(index, checked)}
              ariaLabel={`${fieldName} option ${index + 1}`}
            />
          ) : (
            <TextField
              type={optionInputType(fieldType)}
              value={typeof option === "string" || typeof option === "number" ? option : ""}
              onChange={(e) => {
                const parsed = parseTypedValue(fieldType, e.target.value);
                updateAt(index, parsed === undefined ? e.target.value : parsed);
              }}
              aria-label={`${fieldName} option ${index + 1}`}
            />
          )}
          <IconButton
            icon={<Trash2 size={16} />}
            aria-label={`Remove ${fieldName} option ${index + 1}`}
            onClick={() => removeAt(index)}
            variant="danger"
            size="sm"
          />
        </div>
      ))}
      <IconButton
        icon={<Plus size={16} />}
        aria-label={`Add ${fieldName} option`}
        onClick={addOption}
        variant="secondary"
        size="sm"
      />
    </div>
  );
}
