import type { ImagePanel } from "../../../types/models";
import { ImagePanel as ImagePanelView } from "../../ImagePanel";

interface ImageRendererProps {
  panel: ImagePanel;
}

export function ImageRenderer({ panel }: ImageRendererProps) {
  return (
    <ImagePanelView
      imageUrl={panel.config.imageUrl || null}
      imageFit={panel.config.imageFit || null}
    />
  );
}
