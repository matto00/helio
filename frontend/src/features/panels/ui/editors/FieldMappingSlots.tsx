// Generic per-slot field-mapping loop, driven by `PANEL_SLOTS[panel.type]`.
// Used by chart (xAxis/yAxis/series) and table (columns) — metric no longer
// uses this (HEL-243 replaces its slots with `MetricValueEditor` +
// `BoundOrLiteralField`; see `BindingEditor`). Extracted out of
// `BindingEditor` to keep that file under the CONTRIBUTING.md file-size
// soft budget.

import { Select, type SelectOption } from "../../../../shared/ui/index";
import type { PanelSlot } from "../../state/panelSlots";

interface FieldMappingSlotsProps {
  slots: PanelSlot[];
  fieldMapping: Record<string, string>;
  onFieldChange: (slotKey: string, value: string) => void;
  fieldOptions: SelectOption[];
}

/** Presentational only — `BindingEditor` owns the `fieldMapping` state and
 *  the save/dirty/reset plumbing. */
export function FieldMappingSlots({
  slots,
  fieldMapping,
  onFieldChange,
  fieldOptions,
}: FieldMappingSlotsProps) {
  return (
    <div className="panel-detail-modal__data-section">
      <span className="panel-detail-modal__data-label">Field mapping</span>
      {slots.map((slot) => (
        <div key={slot.key} className="panel-detail-modal__mapping-row">
          <label className="panel-detail-modal__mapping-label" htmlFor={`slot-${slot.key}`}>
            {slot.label}
          </label>
          <Select
            ariaLabel={`${slot.label} field`}
            value={fieldMapping[slot.key] ?? ""}
            onChange={(v) => onFieldChange(slot.key, v)}
            placeholder="— None —"
            options={fieldOptions}
          />
        </div>
      ))}
    </div>
  );
}
