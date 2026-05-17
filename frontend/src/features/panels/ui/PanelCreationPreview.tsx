import "./PanelCreationModal.css";
import type { Panel, PanelType, TypeConfig } from "../types/panel";
import { emptyConfigForKind } from "../types/panel";
import { PanelContent } from "./PanelContent";

interface PanelCreationPreviewProps {
  type: PanelType;
  title: string;
  typeConfig?: TypeConfig | null;
}

/** Builds a minimal in-memory [[Panel]] for the modal's live preview, mirroring
 *  the typed-config wire shape the backend would produce on create. The
 *  preview never touches the network — IDs are placeholders. */
function buildPreviewPanel(type: PanelType, typeConfig: TypeConfig | null | undefined): Panel {
  const base = {
    id: "preview",
    dashboardId: "preview",
    title: "",
    meta: { createdBy: "preview", createdAt: "", lastUpdated: "" },
    appearance: { background: "", color: "", transparency: 0 },
    ownerId: "preview",
    refreshInterval: null,
  };
  const config = emptyConfigForKind(type);
  switch (type) {
    case "image": {
      const imageUrl = typeConfig?.type === "image" ? (typeConfig.imageUrl ?? "") : "";
      return {
        ...base,
        type: "image",
        config: { ...(config as { imageUrl: string; imageFit: string }), imageUrl },
      };
    }
    case "divider": {
      const orientation =
        typeConfig?.type === "divider" && typeConfig.dividerOrientation
          ? typeConfig.dividerOrientation
          : (config as { orientation: string }).orientation;
      return {
        ...base,
        type: "divider",
        config: { ...(config as { orientation: string }), orientation },
      };
    }
    case "metric":
      return {
        ...base,
        type: "metric",
        config: config as { dataTypeId: string; fieldMapping: Record<string, string> },
      };
    case "chart":
      return {
        ...base,
        type: "chart",
        config: config as { dataTypeId: string; fieldMapping: Record<string, string> },
      };
    case "table":
      return {
        ...base,
        type: "table",
        config: config as { dataTypeId: string; fieldMapping: Record<string, string> },
      };
    case "text":
      return { ...base, type: "text", config: config as { content: string } };
    case "markdown":
      return { ...base, type: "markdown", config: config as { content: string } };
  }
}

export function PanelCreationPreview({ type, title, typeConfig }: PanelCreationPreviewProps) {
  const displayTitle = title.trim() || "Untitled";
  const isPlaceholder = title.trim() === "";
  const previewPanel = buildPreviewPanel(type, typeConfig);

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
          <PanelContent panel={previewPanel} />
        </div>
      </div>
    </div>
  );
}
