import "./PanelCreationModal.css";
import type { PanelType } from "../types/models";
import { PanelContent } from "./PanelContent";

interface PanelCreationPreviewProps {
  type: PanelType;
  title: string;
}

export function PanelCreationPreview({ type, title }: PanelCreationPreviewProps) {
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
          <PanelContent type={type} />
        </div>
      </div>
    </div>
  );
}
