// HEL-1084 design.md D5/D7 — one form field's row: field chooser, control
// chooser, label/placeholder/help text, required, initial value, step
// (number only), options (select only), and reorder/remove controls.

import { useId, type RefObject } from "react";

import { FormField, IconButton, Select, TextField, Toggle } from "../../../../shared/ui/index";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { fittingControls, parseTypedValue } from "../../state/formConfigValidation";
import { FormOptionsEditor } from "./FormOptionsEditor";
import type { DatasetFieldResponse } from "../../../sources/types/dataSource";
import type { FormFieldSpec } from "../../types/panel";

interface FormFieldRowProps {
  field: FormFieldSpec;
  index: number;
  total: number;
  /** Declared fields still selectable for THIS row: every declared field not
   *  used by another row, plus this row's own current field. */
  availableFields: DatasetFieldResponse[];
  /** This row's own declared field, or `undefined` when it names a
   *  sourceField the bound dataset doesn't declare (orphaned). */
  declaredField: DatasetFieldResponse | undefined;
  error?: string;
  onSourceFieldChange: (sourceField: string) => void;
  onControlChange: (control: FormFieldSpec["control"]) => void;
  onAttrChange: (attr: Partial<FormFieldSpec>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  /** Forwarded to the row's field-chooser wrapper so `FormEditor` can move
   *  focus into a newly-added row's first control (design.md D7) via
   *  `querySelector('button, input, select')` on this element. */
  fieldSelectContainerRef?: RefObject<HTMLDivElement | null>;
}

export function FormFieldRow({
  field,
  index,
  total,
  availableFields,
  declaredField,
  error,
  onSourceFieldChange,
  onControlChange,
  onAttrChange,
  onMoveUp,
  onMoveDown,
  onRemove,
  fieldSelectContainerRef,
}: FormFieldRowProps) {
  const fieldLabel = field.label?.trim() || field.sourceField || `field ${index + 1}`;
  const fitting = declaredField ? fittingControls(declaredField.type) : [];
  const datasetRequired = declaredField?.required === true;
  // skeptic-final-1.md CR1 — a stable id for the sourceField error, threaded
  // onto the Select trigger's aria-describedby (plus aria-invalid) so the
  // association survives past the error <p>'s one-shot role="alert"
  // announcement, for a screen-reader user who tabs directly to the control.
  const sourceFieldErrorId = useId();

  const fieldOptions = availableFields.map((f) => ({
    value: f.name,
    label: `${f.name} (${f.type}${f.required ? ", required" : ""})`,
  }));
  if (!declaredField && field.sourceField) {
    fieldOptions.unshift({ value: field.sourceField, label: `${field.sourceField} (undeclared)` });
  }

  return (
    <div className="form-editor__row" role="group" aria-label={`Field: ${fieldLabel}`}>
      <div className="form-editor__row-header">
        <div ref={fieldSelectContainerRef ?? undefined}>
          <FormField label={`Field for ${fieldLabel}`} error={error} errorId={sourceFieldErrorId}>
            <Select
              ariaLabel={`Field for ${fieldLabel}`}
              value={field.sourceField}
              onChange={onSourceFieldChange}
              options={fieldOptions}
              ariaInvalid={Boolean(error)}
              ariaDescribedBy={error ? sourceFieldErrorId : undefined}
            />
          </FormField>
        </div>
        <div className="form-editor__row-actions">
          <IconButton
            icon={<ArrowUp size={16} />}
            aria-label={`Move ${fieldLabel} up`}
            onClick={onMoveUp}
            disabled={index === 0}
            variant="ghost"
            size="sm"
          />
          <IconButton
            icon={<ArrowDown size={16} />}
            aria-label={`Move ${fieldLabel} down`}
            onClick={onMoveDown}
            disabled={index === total - 1}
            variant="ghost"
            size="sm"
          />
          <IconButton
            icon={<Trash2 size={16} />}
            aria-label={`Remove ${fieldLabel}`}
            onClick={onRemove}
            variant="danger"
            size="sm"
          />
        </div>
      </div>

      {declaredField && (
        <>
          <FormField label={`Control for ${fieldLabel}`}>
            <Select
              ariaLabel={`Control for ${fieldLabel}`}
              value={field.control}
              onChange={(v) => onControlChange(v as FormFieldSpec["control"])}
              options={fitting.map((c) => ({ value: c, label: c }))}
            />
          </FormField>

          <FormField label={`Label for ${fieldLabel}`}>
            <TextField
              aria-label={`Label for ${fieldLabel}`}
              value={field.label ?? ""}
              onChange={(e) => onAttrChange({ label: e.target.value || undefined })}
            />
          </FormField>

          <FormField label={`Placeholder for ${fieldLabel}`}>
            <TextField
              aria-label={`Placeholder for ${fieldLabel}`}
              value={field.placeholder ?? ""}
              onChange={(e) => onAttrChange({ placeholder: e.target.value || undefined })}
            />
          </FormField>

          <FormField label={`Help text for ${fieldLabel}`}>
            <TextField
              aria-label={`Help text for ${fieldLabel}`}
              value={field.helpText ?? ""}
              onChange={(e) => onAttrChange({ helpText: e.target.value || undefined })}
            />
          </FormField>

          <FormField
            label={`Required for ${fieldLabel}`}
            hint={datasetRequired ? "Required by the dataset" : undefined}
          >
            <Toggle
              ariaLabel={`Required for ${fieldLabel}`}
              checked={datasetRequired || field.required === true}
              disabled={datasetRequired}
              onChange={(checked) => onAttrChange({ required: checked ? true : undefined })}
            />
          </FormField>

          <FormField label={`Initial value for ${fieldLabel}`}>
            <TextField
              aria-label={`Initial value for ${fieldLabel}`}
              value={
                typeof field.initialValue === "string" || typeof field.initialValue === "number"
                  ? String(field.initialValue)
                  : ""
              }
              onChange={(e) => {
                const parsed = parseTypedValue(declaredField.type, e.target.value);
                onAttrChange({ initialValue: parsed === undefined ? undefined : parsed });
              }}
            />
          </FormField>

          {field.control === "number" && (
            <FormField label={`Step for ${fieldLabel}`}>
              <TextField
                type="number"
                aria-label={`Step for ${fieldLabel}`}
                value={field.step ?? ""}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  onAttrChange({ step: e.target.value === "" || Number.isNaN(n) ? undefined : n });
                }}
              />
            </FormField>
          )}

          {field.control === "select" && (
            <FormField label={`Options for ${fieldLabel}`}>
              <FormOptionsEditor
                fieldName={fieldLabel}
                fieldType={declaredField.type}
                options={Array.isArray(field.options) ? field.options : []}
                onChange={(options) => onAttrChange({ options })}
              />
            </FormField>
          )}
        </>
      )}
    </div>
  );
}
