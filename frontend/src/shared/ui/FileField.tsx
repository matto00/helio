import { useId } from "react";

import "./FileField.css";

interface FileFieldProps {
  id?: string;
  value: File | null;
  onChange: (file: File | null) => void;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
  ariaRequired?: boolean;
  disabled?: boolean;
  className?: string;
}

/** File-picker primitive (HEL-1086) — a native `<input type="file">`, so keyboard/AT support is
 *  free (Tab reaches it in document order, Enter/Space opens the platform file-selection UI,
 *  exactly like any native control — no bespoke key handling needed). Its accessible name comes
 *  from the caller's own `<label htmlFor={id}>` (mirrors `TextField`'s convention — no `ariaLabel`
 *  override prop, unlike `Select`/`Toggle`, which aren't natively labelable the same way).
 *
 *  Pairs the native input with a visible, separately-`id`'d status span holding "No file
 *  selected" or the chosen file's name — a native file input's own OS-rendered filename text is
 *  inconsistent across browsers and not reliably exposed to assistive tech, so this status span
 *  is threaded onto `aria-describedby` (merged with any caller-supplied id) to keep the
 *  selected-file state part of the control's computed accessible description at all times. */
export function FileField({
  id,
  value,
  onChange,
  ariaInvalid,
  ariaDescribedBy,
  ariaRequired,
  disabled = false,
  className,
}: FileFieldProps) {
  const statusId = useId();
  const describedBy = [ariaDescribedBy, statusId].filter(Boolean).join(" ") || undefined;
  const classes = ["ui-file-field", className ?? null].filter(Boolean).join(" ");

  return (
    <div className={classes}>
      <input
        id={id}
        type="file"
        className="ui-file-field__input"
        disabled={disabled}
        aria-invalid={ariaInvalid ? "true" : undefined}
        aria-describedby={describedBy}
        aria-required={ariaRequired ? "true" : undefined}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
      <span id={statusId} className="ui-file-field__status">
        {value ? value.name : "No file selected"}
      </span>
    </div>
  );
}
