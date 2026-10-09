import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { isOutputPanel } from "../../state/panelNarrowing";
import { useOutputMeta } from "../../hooks/useOutputMeta";
import { listOutputPanels } from "../../../pipelines/services/outputService";
import { OutputPicker } from "../OutputPicker";
import { ProvenanceTrigger } from "../../provenance/ProvenanceTrigger";
import type { Panel } from "../../types/panel";

/** HEL-909 — the placements/Output-link/Swap-output section of the Panel
 *  sheet for an output-kind panel. Fetches the Output's own metadata (for
 *  the pipeline link) and its placement count separately from
 *  `usePanelData` (which only fetches rows). */
export function OutputPanelSection({ panel }: { panel: Panel }) {
  const outputId = isOutputPanel(panel) ? panel.config.outputId : "";
  const { output } = useOutputMeta(outputId);
  const [placementCount, setPlacementCount] = useState<number | null>(null);
  const [swapPickerOpen, setSwapPickerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void listOutputPanels(outputId)
      .then((placements) => {
        // "Used on N dashboards" counts distinct dashboards, not panel
        // placements -- two panels on the same dashboard bound to this
        // Output must read "Used on 1 dashboards", not 2 (HEL-909
        // non-blocking suggestion).
        const dashboardCount = new Set(placements.map((p) => p.dashboardId)).size;
        if (!cancelled) setPlacementCount(dashboardCount);
      })
      .catch(() => {
        if (!cancelled) setPlacementCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [outputId]);

  return (
    <div className="panel-detail-modal__data-section">
      <h3 className="panel-detail-modal__edit-section-heading">Output</h3>
      {output ? (
        <Link
          to={`/pipelines/${output.pipelineId}?outputId=${output.id}`}
          className="panel-detail-modal__output-link"
        >
          {output.name}
        </Link>
      ) : (
        <span className="panel-detail-modal__output-link-loading">Loading…</span>
      )}
      {/* HEL-1207 A1: provenance answers "where did this come from"; the link above names the output. */}
      {outputId ? (
        <ProvenanceTrigger
          panelId={panel.id}
          panelTitle={panel.title}
          outputId={outputId}
          variant="authenticated"
        />
      ) : null}
      <button
        type="button"
        className="panel-detail-modal__swap-output-btn"
        onClick={() => setSwapPickerOpen(true)}
      >
        Swap output
      </button>
      <p className="panel-detail-modal__placements-note">
        {placementCount === null
          ? "Used on — dashboards"
          : `Used on ${placementCount} dashboard${placementCount === 1 ? "" : "s"}`}
      </p>
      {swapPickerOpen ? (
        <OutputPicker
          dashboardId={panel.dashboardId}
          currentDashboardPanels={[]}
          mode="swap"
          swapPanelId={panel.id}
          onClose={() => setSwapPickerOpen(false)}
        />
      ) : null}
    </div>
  );
}
