import { useId, type ReactNode } from "react";

import "./FormField.css";

interface FormFieldProps {
  /** Field label text. */
  label: ReactNode;
  /** Id of the control this label describes — wired to the label's `htmlFor`. */
  htmlFor?: string;
  /** Marks the field optional; renders a muted "(optional)" suffix on the label. */
  optional?: boolean;
  /** Validation error. When present, replaces `hint` and is announced via `role="alert"`. */
  error?: string | null;
  /** Secondary helper text shown under the control when there is no error. */
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
  /** Stable id for the error `<p>` (HEL-1084 skeptic-final-1.md CR1). `role="alert"`
   *  alone is a one-shot live-region announcement — it creates no durable
   *  programmatic association with the control, so a caller that needs
   *  `aria-invalid`/`aria-describedby` on its own control (per DESIGN.md §8 /
   *  this ticket's design.md D7) must pass an id here and thread the SAME id
   *  onto that control's `aria-describedby`. Optional: existing callers that
   *  don't need this wiring can omit it — an internal id is still generated
   *  and applied to the error `<p>` either way, so `error`'s behavior for
   *  every pre-existing call site is unchanged. */
  errorId?: string;
  /** Stable id for the hint `<p>` (task 2.2, design.md D4). Threaded onto a
   *  caller's own control `aria-describedby` when no error is shown, so the
   *  control's computed accessible description resolves to the hint text.
   *  Never applied to the error `<p>` — that one uses `errorId`. */
  hintId?: string;
}

/** Label + control + error/hint wrapper for form fields (F-058). Replaces the
 * ~10 hand-rolled `.xxx__field { display:flex; flex-direction:column; gap:... }`
 * recipes scattered across feature CSS with one tokened, consistent layout.
 * Adopted by `FormFieldRow.tsx` (HEL-1084) and the connector-setup forms;
 * new forms should reach for this instead of re-deriving the recipe. */
export function FormField({
  label,
  htmlFor,
  optional = false,
  error,
  hint,
  className,
  children,
  errorId,
  hintId,
}: FormFieldProps) {
  const classes = ["ui-form-field", className ?? null].filter(Boolean).join(" ");
  const generatedErrorId = useId();
  const resolvedErrorId = errorId ?? generatedErrorId;

  return (
    <div className={classes}>
      <label className="ui-form-field__label" htmlFor={htmlFor}>
        {label}
        {optional ? <span className="ui-form-field__optional"> (optional)</span> : null}
      </label>
      {children}
      {error ? (
        <p id={resolvedErrorId} className="ui-form-field__error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="ui-form-field__hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
