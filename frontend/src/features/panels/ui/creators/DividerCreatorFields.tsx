// Divider subtype creator fields — orientation selector (horizontal /
// vertical).
//
// Rendered by PanelCreationModal's name-entry step when selectedType is
// "divider". The shell narrows `typeConfig` into a `DividerTypeConfig`
// before passing it in so the Select stays controlled from first render.

import { Select } from "../../../../shared/ui/index";
import type { DividerOrientation, DividerTypeConfig } from "../../types/panel";
import type { CreatorFieldsProps } from "./creatorTypes";

export function DividerCreatorFields({ config, onChange }: CreatorFieldsProps<DividerTypeConfig>) {
  return (
    <div className="panel-creation-modal__field">
      <label className="panel-creation-modal__label" htmlFor="panel-create-orientation">
        Orientation
      </label>
      <Select
        ariaLabel="Orientation"
        value={config.dividerOrientation ?? ""}
        onChange={(v) =>
          onChange({
            ...config,
            dividerOrientation: v ? (v as DividerOrientation) : undefined,
          })
        }
        placeholder="Select orientation"
        options={[
          { value: "horizontal", label: "Horizontal" },
          { value: "vertical", label: "Vertical" },
        ]}
      />
    </div>
  );
}
