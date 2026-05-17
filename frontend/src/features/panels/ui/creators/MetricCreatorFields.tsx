// Metric subtype creator fields — value label + unit inputs.
//
// Rendered by PanelCreationModal's name-entry step when selectedType is
// "metric". The shell narrows `typeConfig` (which may be null or a
// different subtype) into a `MetricTypeConfig` before passing it in so
// these inputs stay controlled from first render.

import { TextField } from "../../../../shared/ui/index";
import type { MetricTypeConfig } from "../../types/panel";
import type { CreatorFieldsProps } from "./creatorTypes";

export function MetricCreatorFields({ config, onChange }: CreatorFieldsProps<MetricTypeConfig>) {
  return (
    <>
      <div className="panel-creation-modal__field">
        <label className="panel-creation-modal__label" htmlFor="panel-create-value-label">
          Value label
        </label>
        <TextField
          id="panel-create-value-label"
          type="text"
          value={config.valueLabel ?? ""}
          onChange={(e) => onChange({ ...config, valueLabel: e.target.value || undefined })}
          placeholder="e.g. Revenue"
          aria-label="Value label"
        />
      </div>
      <div className="panel-creation-modal__field">
        <label className="panel-creation-modal__label" htmlFor="panel-create-unit">
          Unit
        </label>
        <TextField
          id="panel-create-unit"
          type="text"
          value={config.unit ?? ""}
          onChange={(e) => onChange({ ...config, unit: e.target.value || undefined })}
          placeholder="e.g. $, %, ms"
          aria-label="Unit"
        />
      </div>
    </>
  );
}
