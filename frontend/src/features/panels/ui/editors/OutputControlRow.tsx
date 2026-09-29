// HEL-1189 design.md D7 — one output-panel control's row: kind badge, orphan indicator, column
// rebind, label, default-value fields (shaped per kind), remove. Sibling split of
// `OutputControlsEditor.tsx`, mirroring `FormEditor.tsx`/`FormFieldRow.tsx`'s own container/row
// split (CONTRIBUTING.md file-size budget).

import { AlertTriangle, Trash2 } from "lucide-react";

import { FormField, IconButton, Select, TextField } from "../../../../shared/ui/index";
import type {
  OutputControlDateRangeValue,
  OutputControlKind,
  OutputControlNumericRangeValue,
  OutputControlSpec,
} from "../../types/panel";

export const KIND_LABELS: Record<OutputControlKind, string> = {
  "date-range": "Date range",
  dropdown: "Dropdown",
  "numeric-range": "Numeric range",
  text: "Text",
};

interface OutputControlRowProps {
  control: OutputControlSpec;
  /** This control's currently-orphaned status (design.md D5) — computed by the caller (which
   *  already holds the fetched capability contract + Output schema), not re-derived here. */
  orphaned: boolean;
  /** Columns currently eligible for this control's own `kind` — the rebind Select's option list. */
  eligibleColumns: string[];
  onRebind: (column: string) => void;
  onLabelChange: (label: string) => void;
  onDefaultValueChange: (value: OutputControlSpec["defaultValue"]) => void;
  onRemove: () => void;
}

export function OutputControlRow({
  control,
  orphaned,
  eligibleColumns,
  onRebind,
  onLabelChange,
  onDefaultValueChange,
  onRemove,
}: OutputControlRowProps) {
  const rowLabel = control.label.trim() || `${KIND_LABELS[control.kind]} control`;
  const columnOptions = eligibleColumns.map((c) => ({ value: c, label: c }));
  if (orphaned && !columnOptions.some((o) => o.value === control.column)) {
    columnOptions.unshift({
      value: control.column,
      label: `${control.column} (no longer eligible)`,
    });
  }

  return (
    <div
      className={`output-controls-editor__row${orphaned ? " output-controls-editor__row--orphaned" : ""}`}
      role="group"
      aria-label={`${KIND_LABELS[control.kind]} control: ${rowLabel}`}
    >
      <div className="output-controls-editor__row-header">
        <span className="output-controls-editor__kind-badge">{KIND_LABELS[control.kind]}</span>
        {orphaned && (
          <span className="output-controls-editor__orphaned-badge">
            <AlertTriangle size={14} aria-hidden="true" />
            Orphaned — bound column no longer fits this control
          </span>
        )}
        <IconButton
          icon={<Trash2 size={16} />}
          aria-label={`Remove ${rowLabel}`}
          onClick={onRemove}
          variant="danger"
          size="sm"
        />
      </div>

      <FormField label={`Column for ${rowLabel}`}>
        <Select
          ariaLabel={`Column for ${rowLabel}`}
          value={control.column}
          onChange={onRebind}
          options={columnOptions}
        />
      </FormField>

      <FormField label={`Label for ${rowLabel}`}>
        <TextField
          aria-label={`Label for ${rowLabel}`}
          value={control.label}
          onChange={(e) => onLabelChange(e.target.value)}
        />
      </FormField>

      <DefaultValueFields control={control} rowLabel={rowLabel} onChange={onDefaultValueChange} />
    </div>
  );
}

/** The author-time default-value input, shaped per `control.kind` (design.md D2's fixed wire
 *  shape) — a plain value per kind, not the richer live-viewer control (leaf 3's concern). */
function DefaultValueFields({
  control,
  rowLabel,
  onChange,
}: {
  control: OutputControlSpec;
  rowLabel: string;
  onChange: (value: OutputControlSpec["defaultValue"]) => void;
}) {
  if (control.kind === "text" || control.kind === "dropdown") {
    const value = typeof control.defaultValue === "string" ? control.defaultValue : "";
    return (
      <FormField label={`Default value for ${rowLabel}`} optional>
        <TextField
          aria-label={`Default value for ${rowLabel}`}
          value={value}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      </FormField>
    );
  }

  if (control.kind === "numeric-range") {
    const current = (control.defaultValue as OutputControlNumericRangeValue | undefined) ?? {
      min: null,
      max: null,
    };
    return (
      <div className="output-controls-editor__range-fields">
        <FormField label={`Default minimum for ${rowLabel}`} optional>
          <TextField
            type="number"
            aria-label={`Default minimum for ${rowLabel}`}
            value={current.min ?? ""}
            onChange={(e) =>
              onChange({ ...current, min: e.target.value === "" ? null : Number(e.target.value) })
            }
          />
        </FormField>
        <FormField label={`Default maximum for ${rowLabel}`} optional>
          <TextField
            type="number"
            aria-label={`Default maximum for ${rowLabel}`}
            value={current.max ?? ""}
            onChange={(e) =>
              onChange({ ...current, max: e.target.value === "" ? null : Number(e.target.value) })
            }
          />
        </FormField>
      </div>
    );
  }

  // date-range
  const current = (control.defaultValue as OutputControlDateRangeValue | undefined) ?? {
    from: null,
    to: null,
  };
  return (
    <div className="output-controls-editor__range-fields">
      <FormField label={`Default start date for ${rowLabel}`} optional>
        <TextField
          type="date"
          aria-label={`Default start date for ${rowLabel}`}
          value={current.from ?? ""}
          onChange={(e) => onChange({ ...current, from: e.target.value || null })}
        />
      </FormField>
      <FormField label={`Default end date for ${rowLabel}`} optional>
        <TextField
          type="date"
          aria-label={`Default end date for ${rowLabel}`}
          value={current.to ?? ""}
          onChange={(e) => onChange({ ...current, to: e.target.value || null })}
        />
      </FormField>
    </div>
  );
}
