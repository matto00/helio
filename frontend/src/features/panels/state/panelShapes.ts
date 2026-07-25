// Panel-type → shape-id mapping for panel creation's "start from a shape"
// affordance (HEL-399 design.md Decision 4). This map only decides *which*
// catalog ids to offer for a given panel type — it filters the live
// `GET /api/pipeline-shapes` response; label/description/paramsSchema always
// come from the catalog, never hardcoded here, so adding a new shape needs
// one array edit, not a duplicated definition.
//
// - `metric` → `single-row`: the only shape with an `ExactlyOne` row-count
//   contract, the only fit for a single-value display.
// - `chart` → `time-series`, `top-n`: one row per time bucket (a natural
//   point-series) or a caller-bounded top-N (a natural bar series).
// - `table` → `top-n`, `pivot-matrix`: a caller-bounded row set, or one row
//   per index-group (a natural row-per-record table shape).
//
// `passthrough` is excluded from every mapping (performs no reduction, so
// offering it would just duplicate the existing "pick an existing DataType"
// path with a worse, multi-step detour).

import type { PanelType } from "../types/panel";

export const PANEL_TYPE_SHAPES: Partial<Record<PanelType, string[]>> = {
  metric: ["single-row"],
  chart: ["time-series", "top-n"],
  table: ["top-n", "pivot-matrix"],
};

/** Shape ids offered for `panelType`, or an empty array if this panel type
 *  offers no shapes (matches `PANEL_TYPE_SHAPES`'s undefined-entry default). */
export function shapesForPanelType(panelType: PanelType | null): string[] {
  if (panelType === null) return [];
  return PANEL_TYPE_SHAPES[panelType] ?? [];
}
