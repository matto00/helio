/**
 * `place_outputs`/`create_content_panel`'s actual call-routing logic
 * (HEL-907 task 3.6), mirroring `pipelineProposalHandlers.ts`'s design.md
 * D4b split: zod-free, so a test can exercise this without pulling
 * `placements.ts`'s zod/`registerTool` surface into the compile graph.
 *
 * Replaces `create_panel`/`create_panels`/`bind_panel`/`create_bound_panel`
 * (all retired, no alias): a panel now carries ONLY placement fields
 * (`config.outputId` for a data-bound placement; no fieldMapping/
 * aggregation on the panel itself anymore, that lives on the Output).
 */

import type { HelioApi } from "../helioApi.js";
import type { PanelResponse } from "../types.js";

export interface PlaceOutputsItem {
  outputId: string;
  title?: string;
  /** Optional per-item size hint (grid units, 12-column). When ANY item in the call carries a
   *  size, a follow-up `auto_layout_dashboard` call positions exactly those items (input order
   *  preserved) — every OTHER already-placed panel on the dashboard keeps its current saved
   *  position, unaffected. Omit both `w` and `h` on every item to skip layout entirely and let
   *  the newly-placed panels fall back to their auto/default position. */
  w?: number;
  h?: number;
}

/** `place_outputs(dashboardId, items)` — creates one `output`-kind placement panel per item
 *  (`POST /api/panels/batch`, all-or-nothing), then, ONLY for items that supplied a `w`/`h` size
 *  hint, follows up with `auto_layout_dashboard` (`POST /api/dashboards/:id/auto-layout`) to
 *  position exactly those newly-created panels — mirrors the pre-existing, documented
 *  create-then-auto_layout composition pattern `auto_layout_dashboard`'s own tool description
 *  already establishes ("Create + bind panels first, then call this with their ids and your
 *  chosen sizes"). A panel with no size hint is left at its auto/default position, same as
 *  calling `create_panel` alone always was. */
export async function placeOutputsHandler(
  api: HelioApi,
  input: { dashboardId: string; items: PlaceOutputsItem[] },
): Promise<{ panels: PanelResponse[] }> {
  const created = await api.placeOutputs(
    input.dashboardId,
    input.items.map((item) => ({ outputId: item.outputId, title: item.title })),
  );

  const sizedItems = input.items
    .map((item, index) => ({ item, panel: created.panels[index] }))
    .filter(
      (entry): entry is { item: PlaceOutputsItem; panel: PanelResponse } =>
        entry.panel !== undefined && (entry.item.w !== undefined || entry.item.h !== undefined),
    );

  if (sizedItems.length > 0) {
    await api.autoLayoutDashboard(
      input.dashboardId,
      sizedItems.map(({ item, panel }) => ({
        panelId: panel.id,
        w: item.w ?? 4,
        h: item.h ?? 4,
      })),
    );
  }

  return created;
}

export function createContentPanelHandler(
  api: HelioApi,
  input: {
    dashboardId: string;
    title?: string;
    type: "text" | "markdown" | "image" | "divider";
    config?: Record<string, unknown>;
    appearance?: Record<string, unknown>;
  },
): Promise<PanelResponse> {
  return api.createContentPanel(input);
}
