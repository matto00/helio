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

import "./PanelCreationModal.css";
import type { Panel, PanelType, TypeConfig } from "../types/panel";
import { emptyConfigForKind } from "../types/panel";
import { PanelContent } from "./PanelContent";

interface PanelCreationPreviewProps {
  type: PanelType;
  title: string;
  typeConfig?: TypeConfig | null;
  /** F-035 — the DataType bound on datatype-select (or via the shape flow),
   *  if any. Null for unbound/non-data-bound types. */
  dataTypeId?: string | null;
  /** Resolved display name for `dataTypeId`. */
  dataTypeName?: string | null;
}

/** Builds a minimal in-memory [[Panel]] for the image preview, mirroring the
 *  typed-config wire shape the backend would produce on create. Image is the
 *  one type this preview still renders "for real" (via `PanelContent` →
 *  `ImageRenderer`) — it needs no fetched data to be honest, unlike every
 *  other type (see file header for why those render a static summary
 *  instead). The preview never touches the network — IDs are placeholders. */
function buildImagePreviewPanel(typeConfig: TypeConfig | null | undefined): Panel {
  const base = {
    id: "preview",
    dashboardId: "preview",
    title: "",
    meta: { createdBy: "preview", createdAt: "", lastUpdated: "" },
    appearance: { background: "", color: "", transparency: 0 },
    ownerId: "preview",
    refreshInterval: null,
  };
  const config = emptyConfigForKind("image");
  const imageUrl = typeConfig?.type === "image" ? (typeConfig.imageUrl ?? "") : "";
  return {
    ...base,
    type: "image",
    config: { ...(config as { imageUrl: string; imageFit: string }), imageUrl },
  };
}

const TYPE_META: Record<PanelType, { icon: IconDefinition; label: string }> = {
  metric: { icon: faChartSimple, label: "Metric" },
  chart: { icon: faChartLine, label: "Chart" },
  text: { icon: faFont, label: "Text" },
  table: { icon: faTableIcon, label: "Table" },
  markdown: { icon: faMarkdownBrand, label: "Markdown" },
  image: { icon: faImage, label: "Image" },
  collection: { icon: faLayerGroup, label: "Collection" },
  timeline: { icon: faTimeline, label: "Timeline" },
  divider: { icon: faLayerGroup, label: "Divider" },
};

const CHART_TYPE_LABEL: Record<string, string> = {
  line: "Line",
  bar: "Bar",
  pie: "Pie",
  scatter: "Scatter",
};

// F-036 — text/markdown have no creator fields in this wizard and are
// meaningful with no data type bound at all; the summary says so instead of
// implying a binding is still required.
const CONTENT_ONLY_TYPES = new Set<PanelType>(["text", "markdown"]);

/** Builds the honest summary line for every type but image — e.g.
 *  "Chart · Line · Bound to Revenue by Region" or "Metric · Revenue ($) ·
 *  No data type selected yet". Never claims a binding exists that wasn't
 *  actually made on this step (F-035) and never shows real fetched data,
 *  since this preview issues no network requests. */
function buildSummaryLine(
  type: PanelType,
  typeConfig: TypeConfig | null | undefined,
  dataTypeName: string | null | undefined,
): string {
  const parts: string[] = [TYPE_META[type].label];

  if (type === "metric" && typeConfig?.type === "metric") {
    const { valueLabel, unit } = typeConfig;
    if (valueLabel && unit) parts.push(`${valueLabel} (${unit})`);
    else if (valueLabel) parts.push(valueLabel);
    else if (unit) parts.push(unit);
  }
  if (type === "chart" && typeConfig?.type === "chart" && typeConfig.chartType) {
    parts.push(CHART_TYPE_LABEL[typeConfig.chartType]);
  }

  if (dataTypeName) {
    parts.push(`Bound to ${dataTypeName}`);
  } else if (CONTENT_ONLY_TYPES.has(type)) {
    parts.push("Content is added after creating this panel");
  } else {
    parts.push("No data type selected yet");
  }

  return parts.join(" · ");
}

export function PanelCreationPreview({
  type,
  title,
  typeConfig,
  dataTypeId,
  dataTypeName,
}: PanelCreationPreviewProps) {
  const displayTitle = title.trim() || "Untitled";
  const isPlaceholder = title.trim() === "";

  return (
    <div className="panel-creation-preview" data-testid="panel-creation-preview">
      <div className="panel-creation-preview__frame">
        <div className="panel-creation-preview__header">
          <span
            className={
              isPlaceholder
                ? "panel-creation-preview__title panel-creation-preview__title--placeholder"
                : "panel-creation-preview__title"
            }
          >
            {displayTitle}
          </span>
        </div>
        <div className="panel-creation-preview__content">
          {type === "image" ? (
            <PanelContent panel={buildImagePreviewPanel(typeConfig)} />
          ) : (
            // F-035 — a static type illustration + honest summary line
            // instead of running the real renderer with no real data: this
            // preview never fetches rows, so a renderer that expects fetched
            // data (ECharts, the bound-collection/timeline placeholders)
            // either errors (the reported "[ECharts] Can't get DOM width or
            // height" console warning) or shows a stale/contradictory hint
            // ("bind a data type" after one was just bound). This always
            // reflects the wizard's actual current state.
            <div
              className="panel-creation-preview__summary"
              data-testid="panel-creation-preview-summary"
            >
              <span className="panel-creation-preview__summary-icon" aria-hidden="true">
                <FontAwesomeIcon icon={TYPE_META[type].icon} />
              </span>
              <span className="panel-creation-preview__summary-text">
                {buildSummaryLine(type, typeConfig, dataTypeId ? dataTypeName : null)}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
