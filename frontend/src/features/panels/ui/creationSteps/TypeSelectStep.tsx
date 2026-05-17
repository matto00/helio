// Type-select step of PanelCreationModal — grid of panel-type cards.
//
// Pure presentational; lifts the static PANEL_TYPES catalogue out of the
// modal shell so the shell can shrink under the 400L file-size cap. The
// shell forwards each card's click to its own `handleTypeSelect` (which
// also resets typeConfig and advances the step machine).

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faChartLine,
  faChartSimple,
  faFont,
  faImage,
  faMinus,
  faTable as faTableIcon,
  type IconDefinition,
} from "@fortawesome/free-solid-svg-icons";
import { faMarkdown as faMarkdownBrand } from "@fortawesome/free-brands-svg-icons";

import type { PanelType } from "../../types/panel";

const PANEL_TYPES: {
  value: PanelType;
  label: string;
  icon: IconDefinition;
  description: string;
}[] = [
  {
    value: "metric",
    label: "Metric",
    icon: faChartSimple,
    description: "Display a single KPI value or stat",
  },
  {
    value: "chart",
    label: "Chart",
    icon: faChartLine,
    description: "Visualize trends with line, bar, or pie",
  },
  { value: "text", label: "Text", icon: faFont, description: "Add freeform text or headings" },
  {
    value: "table",
    label: "Table",
    icon: faTableIcon,
    description: "Show structured data in rows and columns",
  },
  {
    value: "markdown",
    label: "Markdown",
    icon: faMarkdownBrand,
    description: "Write formatted content with Markdown",
  },
  { value: "image", label: "Image", icon: faImage, description: "Embed an image from a URL" },
  {
    value: "divider",
    label: "Divider",
    icon: faMinus,
    description: "Separate sections with a visual line",
  },
];

interface TypeSelectStepProps {
  onSelect: (type: PanelType) => void;
}

export function TypeSelectStep({ onSelect }: TypeSelectStepProps) {
  return (
    <div className="panel-creation-modal__type-grid" role="group" aria-label="Panel type">
      {PANEL_TYPES.map(({ value, label, icon, description }) => (
        <button
          key={value}
          type="button"
          className="panel-creation-modal__type-card"
          aria-label={label}
          onClick={() => onSelect(value)}
        >
          <span className="panel-creation-modal__type-icon" aria-hidden="true">
            <FontAwesomeIcon icon={icon} />
          </span>
          <span className="panel-creation-modal__type-label">{label}</span>
          <span className="panel-creation-modal__type-description">{description}</span>
        </button>
      ))}
    </div>
  );
}
