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
  faLayerGroup,
  faTable as faTableIcon,
  faTimeline,
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
    description: "Visualize trends with line, bar, pie, or scatter",
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
    value: "collection",
    label: "Collection",
    icon: faLayerGroup,
    description: "Render one tile per row of a data type",
  },
  {
    value: "timeline",
    label: "Timeline",
    icon: faTimeline,
    description: "Show a chronological sequence of time-stamped events",
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
          // F-210 — `aria-labelledby`/`aria-describedby` instead of an
          // `aria-label` override, so the description is exposed to AT as an
          // accessible description rather than silently dropped.
          aria-labelledby={`type-label-${value}`}
          aria-describedby={`type-desc-${value}`}
          onClick={() => onSelect(value)}
        >
          <span className="panel-creation-modal__type-icon" aria-hidden="true">
            <FontAwesomeIcon icon={icon} />
          </span>
          <span id={`type-label-${value}`} className="panel-creation-modal__type-label">
            {label}
          </span>
          <span id={`type-desc-${value}`} className="panel-creation-modal__type-description">
            {description}
          </span>
        </button>
      ))}
    </div>
  );
}
