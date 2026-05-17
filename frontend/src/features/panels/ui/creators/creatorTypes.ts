// Shared shapes for per-subtype creator field components.
//
// PanelCreationModal owns the modal lifecycle (step machine, title,
// data-binding step, dirty guard). Each subtype-specific creator is a
// self-contained controlled section that renders its config fields and
// reports changes through a typed `onChange`. The shell keeps the
// authoritative `TypeConfig` in its own state and feeds each creator a
// non-null narrowed config so the inputs stay controlled even before the
// user picks a type-specific value.

import type { TypeConfig } from "../../types/panel";

/** Generic controlled-fields contract for a single panel-subtype creator. */
export interface CreatorFieldsProps<TConfig extends TypeConfig> {
  config: TConfig;
  onChange: (config: TConfig) => void;
}

/** Returns true if `typeConfig` has at least one non-empty value worth
 *  submitting in the create-panel payload. Used by the shell to decide
 *  whether to include the `typeConfig` key at all and to track dirty
 *  state for the discard-changes guard. */
export function hasNonEmptyTypeConfig(config: TypeConfig | null): config is TypeConfig {
  if (!config) return false;
  switch (config.type) {
    case "metric":
      return !!(config.valueLabel || config.unit);
    case "chart":
      return !!config.chartType;
    case "image":
      return !!config.imageUrl;
    case "divider":
      return !!config.dividerOrientation;
  }
}
