// Reusable "bind to field, or fixed text" control (HEL-243 design.md Decision
// 2). Any panel config slot whose value can be either a DataType field
// binding or literal text renders this: a mode toggle (Bind to field / Fixed
// text) plus a single input that switches between a field-select dropdown
// and a text field depending on the selected mode.
//
// This is the piece HEL-244 (Text), HEL-245 (Markdown), and HEL-247
// (Collections) copy directly for their own field-or-literal slots — see the
// `panel-config-field-or-literal-pattern` capability spec for the documented
// contract (props shape + mode-default heuristic).

import { Select, Textarea, TextField, type SelectOption } from "../../../../shared/ui/index";

export type BoundOrLiteralMode = "field" | "literal";

/** The mode-default heuristic (design.md Decision 2 / Decision 4): a slot
 *  defaults to "literal" when a literal override is already configured
 *  (matches HEL-293's documented literal-wins precedence), else "field".
 *  Exported so HEL-244/245/247 derive their own initial mode the same way
 *  instead of re-deriving the heuristic. */
export function defaultBoundOrLiteralMode(literalIsSet: boolean): BoundOrLiteralMode {
  return literalIsSet ? "literal" : "field";
}

interface BoundOrLiteralFieldProps {
  /** Row label, e.g. "Label" / "Unit". Also used to derive the field/text
   *  input's `aria-label` (`"${label} field"` / `"${label} text"`). */
  label: string;
  mode: BoundOrLiteralMode;
  onModeChange: (mode: BoundOrLiteralMode) => void;
  fieldOptions: SelectOption[];
  fieldValue: string;
  onFieldChange: (value: string) => void;
  literalValue: string;
  onLiteralChange: (value: string) => void;
  literalPlaceholder?: string;
  /** HEL-244: when true, the literal-mode input renders as a multiline
   *  `Textarea` instead of a single-line `TextField` — for long-form
   *  literal slots (Text's `content`) rather than Metric's Label/Unit.
   *  Defaults to `false`; omitting the prop preserves today's single-line
   *  behavior for existing callers. */
  literalMultiline?: boolean;
}

/** Mode toggle + Select-or-TextField, per design.md Decision 2. Presentational
 *  only — the caller owns the mode/field/literal state and any save/dirty
 *  plumbing (mirrors `MetricValueEditor`). */
export function BoundOrLiteralField({
  label,
  mode,
  onModeChange,
  fieldOptions,
  fieldValue,
  onFieldChange,
  literalValue,
  onLiteralChange,
  literalPlaceholder,
  literalMultiline = false,
}: BoundOrLiteralFieldProps) {
  return (
    <div
      className={`panel-detail-modal__mapping-row${
        literalMultiline ? " panel-detail-modal__mapping-row--align-top" : ""
      }`}
    >
      <span className="panel-detail-modal__mapping-label">{label}</span>
      <div className="panel-detail-modal__mode-field">
        <div className="panel-detail-modal__mode-toggle" role="group" aria-label={`${label} mode`}>
          <button
            type="button"
            className={`panel-detail-modal__mode-toggle-btn${
              mode === "field" ? " panel-detail-modal__mode-toggle-btn--active" : ""
            }`}
            aria-pressed={mode === "field"}
            onClick={() => onModeChange("field")}
          >
            Bind to field
          </button>
          <button
            type="button"
            className={`panel-detail-modal__mode-toggle-btn${
              mode === "literal" ? " panel-detail-modal__mode-toggle-btn--active" : ""
            }`}
            aria-pressed={mode === "literal"}
            onClick={() => onModeChange("literal")}
          >
            Fixed text
          </button>
        </div>
        {mode === "field" ? (
          <Select
            ariaLabel={`${label} field`}
            value={fieldValue}
            onChange={onFieldChange}
            placeholder="— None —"
            options={fieldOptions}
          />
        ) : literalMultiline ? (
          <Textarea
            value={literalValue}
            onChange={(e) => onLiteralChange(e.target.value)}
            placeholder={literalPlaceholder}
            aria-label={`${label} text`}
            rows={12}
          />
        ) : (
          <TextField
            type="text"
            value={literalValue}
            onChange={(e) => onLiteralChange(e.target.value)}
            placeholder={literalPlaceholder}
            aria-label={`${label} text`}
          />
        )}
      </div>
    </div>
  );
}
