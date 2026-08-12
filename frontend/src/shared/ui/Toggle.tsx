import "./Toggle.css";

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Visible label rendered beside the switch. Also used as the accessible
   *  name when `ariaLabel` is omitted. */
  label?: string;
  /** Accessible name override — use when the visible label text isn't a
   *  sufficient standalone name (rare; most callers should just pass `label`). */
  ariaLabel?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/** Minimal switch primitive (HEL-553 design.md D4) — no other checkbox/switch
 *  control existed in `shared/ui` prior to this. Deliberately kept to
 *  checked/onChange/label/disabled; no variants beyond what a single boolean
 *  toggle (e.g. a metric's "Deprecated" flag) needs. Built on a native
 *  `<input type="checkbox" role="switch">` for keyboard/AT support, with the
 *  track/thumb as sibling CSS driven off `:checked`. */
export function Toggle({
  checked,
  onChange,
  label,
  ariaLabel,
  disabled = false,
  id,
  className,
}: ToggleProps) {
  const classes = ["ui-toggle", disabled ? "ui-toggle--disabled" : null, className ?? null]
    .filter(Boolean)
    .join(" ");

  return (
    <label className={classes} htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="ui-toggle__input"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel ?? label}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="ui-toggle__track" aria-hidden="true">
        <span className="ui-toggle__thumb" />
      </span>
      {label !== undefined && <span className="ui-toggle__label">{label}</span>}
    </label>
  );
}
