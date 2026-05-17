// Template-select step of PanelCreationModal — list of templates for the
// selected panel type plus a "Start blank" affordance and a Back button.
//
// Pure presentational. The shell decides what happens after a template is
// chosen (advance to datatype-select for data-bound types, name-entry
// otherwise) and what Back means.

import type { PanelTemplate } from "../../state/panelTemplates";

interface TemplateSelectStepProps {
  templates: readonly PanelTemplate[];
  onSelect: (template: PanelTemplate | null) => void;
  onBack: () => void;
}

export function TemplateSelectStep({ templates, onSelect, onBack }: TemplateSelectStepProps) {
  return (
    <div className="panel-creation-modal__template-step">
      <div className="panel-creation-modal__template-grid" role="group" aria-label="Panel template">
        {templates.map((template) => (
          <button
            key={template.id}
            type="button"
            className="panel-creation-modal__template-card"
            aria-label={template.label}
            onClick={() => onSelect(template)}
          >
            <span className="panel-creation-modal__template-label">{template.label}</span>
            <span className="panel-creation-modal__template-description">
              {template.description}
            </span>
          </button>
        ))}
        <button
          type="button"
          className="panel-creation-modal__template-card panel-creation-modal__template-card--blank"
          aria-label="Start blank"
          onClick={() => onSelect(null)}
        >
          <span className="panel-creation-modal__template-label">Start blank</span>
          <span className="panel-creation-modal__template-description">
            Begin with an empty panel
          </span>
        </button>
      </div>
      <div className="panel-creation-modal__actions">
        <button
          type="button"
          className="panel-creation-modal__btn panel-creation-modal__btn--secondary"
          onClick={onBack}
        >
          Back
        </button>
      </div>
    </div>
  );
}
