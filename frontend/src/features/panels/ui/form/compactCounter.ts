// HEL-1618 — the one compact-counter predicate, shared by `FormPanelView` (layout choice) and the desktop grid's
// minimum-rows helper. design.md Decision 1/2: exactly one field and it is a counter. Zero fields, one non-counter
// field and 2+ fields (a missing config included) are NOT compact counters.

import type { FormPanelConfig } from "../../types/panel";

export function isCompactCounterConfig(
  config: Pick<FormPanelConfig, "fields"> | undefined,
): boolean {
  return config?.fields?.length === 1 && config.fields[0].control === "counter";
}
