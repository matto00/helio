// HEL-1085 design.md D1 — the ImageRenderer/DividerRenderer shape (panel in, view out). Renders
// the unconfigured placeholder for an empty field list, else delegates to `FormPanelView`.

import { useDashboardRole } from "../../../dashboards/state/dashboardAccessContext";
import { FormPanelView } from "../form/FormPanelView";
import type { FormPanel } from "../../types/panel";

interface FormRendererProps {
  panel: FormPanel;
}

export function FormRenderer({ panel }: FormRendererProps) {
  // HEL-1773: `POST /api/panels/:id/submit` is owner-only for every non-owner (editors included), so a form on a shared
  // dashboard offers no fields to submit: it says who can (child 3 of the ticket decides whether editors may).
  const role = useDashboardRole();
  if (panel.config.fields.length === 0) {
    return (
      <div className="panel-content panel-content--state" role="status">
        <span className="panel-content__state-label">Form not configured</span>
      </div>
    );
  }
  if (role !== "owner") {
    return (
      <div className="panel-content panel-content--state" role="status">
        <span className="panel-content__state-label">Only the owner can submit this form</span>
      </div>
    );
  }
  return <FormPanelView title={panel.title} panelId={panel.id} config={panel.config} />;
}
