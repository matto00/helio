// The "Placements (n)" list of an existing Output (extracted verbatim from `OutputEditorSheet.tsx`).

import type { OutputPanelPlacement } from "../../types/output";

export function OutputPlacementsList({ placements }: { placements: OutputPanelPlacement[] }) {
  return (
    <div className="output-editor-sheet__group">
      <div className="output-editor-sheet__data-section">
        <span className="output-editor-sheet__data-label">Placements ({placements.length})</span>
        {placements.length === 0 ? (
          <p className="output-editor-sheet__field-hint">Not placed on any dashboard yet.</p>
        ) : (
          <ul className="output-editor-sheet__placements">
            {placements.map((p) => (
              <li key={p.panelId}>
                <a href={`/dashboards/${p.dashboardId}`}>Dashboard {p.dashboardId}</a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
