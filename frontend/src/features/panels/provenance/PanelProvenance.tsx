import { usePanelReadScope } from "../state/panelReadScope";
import { getOutputId } from "../state/panelNarrowing";
import type { Panel } from "../types/panel";
import { ProvenanceTrigger } from "./ProvenanceTrigger";

/** HEL-1780 D8 -- the provenance control of an output-bound panel, read through the panel's own scope: the Output route for
 *  the owner of the panel's dashboard, `/api/dashboards/:id/panels/:panelId/provenance` (no share token) for everyone
 *  else. The "Invalid data" badge shows when the caller passes `invalidBadge`, in either scope (HEL-1786: a non-owner's flag
 *  comes from the dashboard panel-status route); in panel scope it opens the public provenance popover. */
export function PanelProvenance({
  panel,
  invalidBadge = false,
  className,
}: {
  panel: Panel;
  invalidBadge?: boolean;
  className?: string;
}) {
  const scope = usePanelReadScope(panel);
  const outputId = getOutputId(panel);
  if (!outputId) return null;
  return (
    <ProvenanceTrigger
      panelId={panel.id}
      panelTitle={panel.title}
      outputId={outputId}
      variant={scope.kind === "panel" ? "public" : "authenticated"}
      dashboardId={scope.kind === "panel" ? scope.dashboardId : undefined}
      invalidBadge={invalidBadge}
      className={className}
    />
  );
}
