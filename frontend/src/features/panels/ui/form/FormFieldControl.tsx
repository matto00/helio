// HEL-1085/HEL-1086 design.md D3/D4/D7 — maps one authored `FormFieldSpec` to the shared
// primitive its `control` calls for (all seven controls, `file` included as of HEL-1086), wrapped
// in `FormField` so name/description/error association is uniform, plus the issue-surfaced
// disabled shape (C3).

import { useId } from "react";

import { CounterControl } from "./CounterControl";
import { FileField } from "../../../../shared/ui/FileField";
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
  /** design.md Decision 1/2 — meaningful only for `control: "counter"`. `true` selects the
   *  compact single-field layout's per-click-submits behavior (`onImmediateStep` is called
   *  instead of `onChange`); `false`/absent (every other layout, including a counter embedded in
   *  a multi-field form) keeps `+`/`-` as ordinary local-value editing via `onChange`, exactly
   *  like typing into a `number` field. */
  immediate?: boolean;
  /** Required when `immediate` is `true` on a `control: "counter"` field — invoked instead of
   *  `onChange` on every `+`/`-`/arrow-key activation, so the caller can submit the delta through
   *  the existing submit path rather than merely updating local state. */
  onImmediateStep?: (direction: 1 | -1) => void;
  /** HEL-1095 design.md D8 — meaningful only for `control: "counter"`: exposes `aria-busy="true"`
   *  on the counter's `role="spinbutton"` element while a submit request from this counter's
   *  immediate-submit path is outstanding. Absent/`false` for every other control, and for a
   *  counter rendered `immediate={false}` (its own submit goes through the shared form button's
   *  `aria-disabled` state instead). */
  busy?: boolean;
  /** HEL-1788 design.md D4 — meaningful only for `control: "counter"`: a caption rendered under the counter and
   *  appended to the spinbutton's accessible description (after any error/hint id, never replacing it). */
  tallyCaption?: string;
  /** HEL-1818 design.md D2 — when set and `error` is non-null, the error text is rendered elsewhere (an external
   *  always-mounted region with this id): `FormField` renders no error paragraph, the control stays invalid, and its
   *  `aria-describedby` points at this id instead of the field's own error id. No effect while `error` is null. */
  errorDescriptionId?: string;
  /** HEL-1587 — every control renders non-interactive (native `disabled`, and `CounterControl`'s own `disabled`, which a
   *  `<fieldset disabled>` would not reach on its non-native spinbutton). Used by the public viewer's read-only preview. */
  disabled?: boolean;
}

export function FormFieldControl({
  field,
  declared,
  issue,
  value,
  error,
  onChange,
  onBlur,
  immediate,
  onImmediateStep,
  busy,
  tallyCaption,
  errorDescriptionId,
  disabled,
}: FormFieldControlProps) {
  const controlId = useId();
  const errorId = useId();
  const hintId = useId();
  const captionId = useId();
  const label = field.label ?? field.sourceField;
  const required = declared ? isFieldRequired(field, declared) : false;
  const externalError = Boolean(error) && errorDescriptionId !== undefined;
  const baseDescribedBy = error
    ? externalError
      ? errorDescriptionId
      : errorId
    : field.helpText
      ? hintId
      : undefined;
  const showCaption = field.control === "counter" && Boolean(tallyCaption);
  const describedBy = showCaption
    ? [baseDescribedBy, captionId].filter(Boolean).join(" ")
    : baseDescribedBy;

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
      error={externalError ? null : error}
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
          immediate,
          onImmediateStep,
          busy,
          disabled,
        })}
        {showCaption && (
          <p id={captionId} className="ui-form-field__hint counter-control__caption">
            {tallyCaption}
          </p>
        )}
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
  immediate?: boolean;
  onImmediateStep?: (direction: 1 | -1) => void;
  busy?: boolean;
  disabled?: boolean;
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
  immediate,
  onImmediateStep,
  busy,
  disabled,
}: RenderControlArgs) {
  const stringValue = typeof value === "string" ? value : "";

  switch (field.control) {
    case "text":
      return (
        <TextField
          id={controlId}
          disabled={disabled}
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
          disabled={disabled}
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
          disabled={disabled}
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
    // HEL-1088 design.md Decision 4: compact value/`+`/`-` chrome with computed ARIA state
    // (`role="spinbutton"`), always required (mirrors `isFieldRequired`'s unconditional override
    // for this control). `step` defaults to `1` when unset (design.md Decision 5, mirroring
    // `number`'s own default-step handling above).
    case "counter": {
      const step = field.step ?? 1;
      const numericValue = stringValue === "" ? 0 : Number(stringValue) || 0;
      const label = field.label ?? field.sourceField;

      function handleStep(direction: 1 | -1) {
        if (immediate) {
          onImmediateStep?.(direction);
        } else {
          onChange(String(numericValue + direction * step));
        }
      }

      return (
        <CounterControl
          id={controlId}
          value={numericValue}
          step={step}
          ariaLabel={label}
          ariaInvalid={invalid}
          ariaDescribedBy={describedBy}
          ariaRequired
          disabled={disabled}
          ariaBusy={immediate ? busy : undefined}
          onStep={handleStep}
        />
      );
    }
    case "date":
      return (
        <TextField
          id={controlId}
          disabled={disabled}
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
          disabled={disabled}
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
          disabled={disabled}
          ariaLabel={field.label ?? field.sourceField}
          ariaInvalid={invalid}
          ariaDescribedBy={describedBy}
          ariaRequired={required}
          onChange={onChange}
        />
      );
    case "file":
      return (
        <FileField
          id={controlId}
          value={value instanceof File ? value : null}
          disabled={disabled}
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
