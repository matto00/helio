import type { ReactNode } from "react";

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
}

/** Label + control + error/hint wrapper for form fields (F-058). Replaces the
 * ~10 hand-rolled `.xxx__field { display:flex; flex-direction:column; gap:... }`
 * recipes scattered across feature CSS with one tokened, consistent layout.
 * Not yet adopted by any call site in this batch — new forms should reach for
 * this instead of re-deriving the recipe; migrating existing forms is a
 * separate follow-up. */
export function FormField({
  label,
  htmlFor,
  optional = false,
  error,
  hint,
  className,
  children,
}: FormFieldProps) {
  const classes = ["ui-form-field", className ?? null].filter(Boolean).join(" ");

  return (
    <div className={classes}>
      <label className="ui-form-field__label" htmlFor={htmlFor}>
        {label}
        {optional ? <span className="ui-form-field__optional"> (optional)</span> : null}
      </label>
      {children}
      {error ? (
        <p className="ui-form-field__error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="ui-form-field__hint">{hint}</p>
      ) : null}
    </div>
  );
}
