// `config.compare` Select options shared by the metric and chart Output editors.

import type { SelectOption } from "../../../../shared/ui/index";

/** HEL-1275 design.md D7 — `config.compare` choices. A pre-existing `custom:<duration>` value is
 *  appended as its own option by `compareOptions` so opening and saving never silently drops it. */
export const METRIC_COMPARE_OPTIONS: SelectOption[] = [
  { value: "none", label: "None" },
  { value: "previous_run", label: "Previous" },
  { value: "1d", label: "1 day" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];

/** HEL-1285 — chart Outputs offer the same choices as metric Outputs, including "Previous": history
 *  thinning never removes an Output's newest 101 points, so `previous_run` is the literal previous run. */
export const CHART_COMPARE_OPTIONS: SelectOption[] = METRIC_COMPARE_OPTIONS;

/** A stored value outside `base` (`previous_run`, `custom:<duration>`) is appended as its own
 *  option so opening and saving never silently drops it. */
export function compareOptions(
  value: string,
  base: SelectOption[] = METRIC_COMPARE_OPTIONS,
): SelectOption[] {
  if (base.some((o) => o.value === value)) return base;
  if (value.startsWith("custom:")) {
    return [...base, { value, label: `Custom (${value.slice("custom:".length)})` }];
  }
  if (value === "previous_run") {
    const stored = METRIC_COMPARE_OPTIONS.find((o) => o.value === value);
    if (stored) return [...base, stored];
  }
  return base;
}
