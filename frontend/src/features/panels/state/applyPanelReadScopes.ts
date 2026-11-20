// HEL-1783 D3: the one place a dashboard's bound Outputs get their read scope, shared by `fetchPanels` (a network load) and
// the warm restore (which never reaches `fetchPanels`). Decided before any card mounts (see `outputMetaCache`): a dashboard the
// caller does not own reads each bound Output through its per-panel routes; an owner's clears any scope a shared dashboard bound
// to the same Output left behind, so an Output the caller owns is never read through the narrower route.

import type { Panel } from "../types/panel";
import { scopeOutputToPanel, unscopeOutput } from "./outputMetaCache";
import { getOutputId } from "./panelNarrowing";

export function applyPanelReadScopes(
  panels: Panel[],
  dashboardId: string,
  nonOwned: boolean,
): void {
  for (const panel of panels) {
    const outputId = getOutputId(panel);
    if (outputId === null) continue;
    if (nonOwned) scopeOutputToPanel(outputId, dashboardId, panel.id);
    else unscopeOutput(outputId);
  }
}
