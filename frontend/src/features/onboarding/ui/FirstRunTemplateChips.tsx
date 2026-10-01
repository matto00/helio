import "./FirstRunTemplateChips.css";
import { PERSONA_TEMPLATES } from "../state/personaTemplates";

interface FirstRunTemplateChipsProps {
  disabled: boolean;
  onChoose: (slug: string) => void;
}

/** Persona sample-data chips (HEL-1210). Real buttons in a labelled group, so Tab/Enter/Space work
 *  with no pointer; each one's accessible name is its persona plus what the sample shows. */
export function FirstRunTemplateChips({ disabled, onChoose }: FirstRunTemplateChipsProps) {
  return (
    <div role="group" aria-labelledby="first-run-templates-label" className="first-run-templates">
      <p id="first-run-templates-label" className="first-run-templates__label">
        No file? Start from sample data
      </p>
      <div className="first-run-templates__list">
        {PERSONA_TEMPLATES.map((template) => (
          <button
            key={template.slug}
            type="button"
            className="first-run-templates__chip"
            disabled={disabled}
            data-template={template.slug}
            onClick={() => onChoose(template.slug)}
          >
            <span className="first-run-templates__name">{template.label}</span>
            <span className="first-run-templates__desc">{template.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
