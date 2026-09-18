// HEL-1085 design.md D1 — the ImageRenderer/DividerRenderer shape (panel in, view out). Renders
// the unconfigured placeholder for an empty field list, else delegates to `FormPanelView`.

import { FormPanelView } from "../form/FormPanelView";
import type { FormPanel } from "../../types/panel";

interface FormRendererProps {
  panel: FormPanel;
}

export function FormRenderer({ panel }: FormRendererProps) {
  if (panel.config.fields.length === 0) {
    return (
      <div className="panel-content panel-content--state" role="status">
        <span className="panel-content__state-label">Form not configured</span>
      </div>
    );
  }
  return <FormPanelView title={panel.title} config={panel.config} />;
}
