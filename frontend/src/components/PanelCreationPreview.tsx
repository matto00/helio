import "./PanelCreationModal.css";
import type { TypeConfig, PanelType } from "../types/models";
import { PanelContent } from "./PanelContent";

interface PanelCreationPreviewProps {
  type: PanelType;
  title: string;
  typeConfig?: TypeConfig | null;
}

export function PanelCreationPreview({ type, title, typeConfig }: PanelCreationPreviewProps) {
  const displayTitle = title.trim() || "Untitled";
  const isPlaceholder = title.trim() === "";

  // Extract preview-relevant fields from typeConfig so the preview reflects live input.
  const imageUrl = typeConfig?.type === "image" ? typeConfig.imageUrl : undefined;
  const dividerOrientation =
    typeConfig?.type === "divider" ? typeConfig.dividerOrientation : undefined;

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
          <PanelContent
            type={type}
            imageUrl={imageUrl ?? null}
            dividerOrientation={dividerOrientation ?? null}
          />
        </div>
      </div>
    </div>
  );
}
