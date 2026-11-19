// HEL-1085 design.md D1 — the ImageRenderer/DividerRenderer shape (panel in, view out). Renders
// the unconfigured placeholder for an empty field list, else delegates to `FormPanelView`.

import { useCanEditPanels } from "../../../dashboards/state/dashboardAccessContext";
import { FormPanelView } from "../form/FormPanelView";
import type { FormPanel } from "../../types/panel";

interface FormRendererProps {
  panel: FormPanel;
}

export function FormRenderer({ panel }: FormRendererProps) {
  // HEL-1784: a dashboard's owner and editors submit its forms; a viewer is told who can.
  const canSubmit = useCanEditPanels();
  if (panel.config.fields.length === 0) {
    return (
      <div className="panel-content panel-content--state" role="status">
        <span className="panel-content__state-label">Form not configured</span>
      </div>
    );
  }
  if (!canSubmit) {
    return (
      <div className="panel-content panel-content--state" role="status">
        <span className="panel-content__state-label">Only editors can submit this form</span>
      </div>
    );
  }
  return (
    <FormPanelView
      title={panel.title}
      panelId={panel.id}
      config={panel.config}
      formOwnerId={panel.ownerId}
    />
  );
}
