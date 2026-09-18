// HEL-1085 design.md D3/D4/D7 — maps one authored `FormFieldSpec` to the shared primitive its
// `control` calls for, wrapped in `FormField` so name/description/error association is uniform
// across all six controls plus the issue/`file` surfaced-but-disabled shapes (C3).

import { useId } from "react";

import { FormField } from "../../../../shared/ui/FormField";
import { Select, type SelectOption } from "../../../../shared/ui/Select";
import { TextField } from "../../../../shared/ui/TextField";
import { Textarea } from "../../../../shared/ui/Textarea";
import { Toggle } from "../../../../shared/ui/Toggle";
import { isFieldRequired } from "../../state/formFieldValidation";
import type { DatasetFieldResponse } from "../../../sources/types/dataSource";
import type { FormFieldSpec } from "../../types/panel";
import type { FormFieldValue } from "./useFormPanelValues";

interface FormFieldControlProps {
  field: FormFieldSpec;
  /** The dataset's declaration for `field.sourceField` — undefined when it's orphaned (no longer
   *  declared). Orphaned/unfit/bad-options fields arrive here via `issue` instead, but the type
   *  stays optional so a genuinely orphaned field can still be passed through explicitly. */
  declared: DatasetFieldResponse | undefined;
  /** Non-null surfaces this field as disabled with `issue` as its accessible description instead
   *  of a live control (design.md D7/C3: orphaned, unfit, malformed options/initialValue). */
  issue?: string | null;
  value: FormFieldValue;
  error: string | null;
  onChange: (value: FormFieldValue) => void;
  onBlur: () => void;
}

export function FormFieldControl({
  field,
  declared,
  issue,
  value,
  error,
  onChange,
  onBlur,
}: FormFieldControlProps) {
  const controlId = useId();
  const errorId = useId();
  const hintId = useId();
  const label = field.label ?? field.sourceField;
  const required = declared ? isFieldRequired(field, declared) : false;
  const describedBy = error ? errorId : field.helpText ? hintId : undefined;

  if (field.control === "file") {
    return (
      <FormField
        label={label}
        htmlFor={controlId}
        hint="File upload is not yet available"
        hintId={hintId}
      >
        <TextField
          id={controlId}
          value=""
          disabled
          placeholder="File upload"
          readOnly
          aria-describedby={hintId}
        />
      </FormField>
    );
  }

  if (issue) {
    return (
      <FormField label={label} htmlFor={controlId} hint={issue} hintId={hintId}>
        <TextField id={controlId} value="" disabled readOnly aria-describedby={hintId} />
      </FormField>
    );
  }

  return (
    <FormField
      label={label}
      htmlFor={controlId}
      error={error}
      errorId={errorId}
      hint={field.helpText}
      hintId={hintId}
    >
      {/* A wrapping `onBlur` (React's synthetic `focusout`, which bubbles) touches the field
       *  uniformly for every control, including `Select`'s trigger button and `Toggle`'s native
       *  input, neither of which exposes its own `onBlur` prop. */}
      <div onBlur={onBlur}>
        {renderControl({
          field,
          declared,
          controlId,
          value,
          required,
          invalid: error !== null,
          describedBy,
          onChange,
        })}
      </div>
    </FormField>
  );
}

interface RenderControlArgs {
  field: FormFieldSpec;
  declared: DatasetFieldResponse | undefined;
  controlId: string;
  value: FormFieldValue;
  required: boolean;
  invalid: boolean;
  describedBy: string | undefined;
  onChange: (value: FormFieldValue) => void;
}

function renderControl({
  field,
  declared,
  controlId,
  value,
  required,
  invalid,
  describedBy,
  onChange,
}: RenderControlArgs) {
  const stringValue = typeof value === "string" ? value : "";

  switch (field.control) {
    case "text":
      return (
        <TextField
          id={controlId}
          type="text"
          value={stringValue}
          placeholder={field.placeholder}
          required={required}
          aria-required={required ? "true" : undefined}
          aria-invalid={invalid ? "true" : undefined}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "textarea":
      return (
        <Textarea
          id={controlId}
          value={stringValue}
          placeholder={field.placeholder}
          required={required}
          aria-required={required ? "true" : undefined}
          aria-invalid={invalid ? "true" : undefined}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "number": {
      const isInteger = declared?.type === "integer";
      return (
        <TextField
          id={controlId}
          type="number"
          value={stringValue}
          placeholder={field.placeholder}
          step={field.step ?? (isInteger ? 1 : "any")}
          inputMode={isInteger ? "numeric" : "decimal"}
          required={required}
          aria-required={required ? "true" : undefined}
          aria-invalid={invalid ? "true" : undefined}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    }
    case "date":
      return (
        <TextField
          id={controlId}
          type="date"
          value={stringValue}
          required={required}
          aria-required={required ? "true" : undefined}
          aria-invalid={invalid ? "true" : undefined}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "select": {
      const options: SelectOption[] = (Array.isArray(field.options) ? field.options : []).map(
        (v) => ({ value: String(v), label: String(v) }),
      );
      return (
        <Select
          value={stringValue}
          options={options}
          ariaLabel={field.label ?? field.sourceField}
          ariaInvalid={invalid}
          ariaDescribedBy={describedBy}
          ariaRequired={required}
          onChange={onChange}
        />
      );
    }
    case "checkbox":
      return (
        <Toggle
          id={controlId}
          checked={value === true}
          ariaLabel={field.label ?? field.sourceField}
          ariaInvalid={invalid}
          ariaDescribedBy={describedBy}
          ariaRequired={required}
          onChange={onChange}
        />
      );
    default:
      return null;
  }
}
