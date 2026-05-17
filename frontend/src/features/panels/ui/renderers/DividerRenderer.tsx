import type { DividerPanel } from "../../../../types/models";
import { DividerPanel as DividerPanelView } from "../DividerPanel";

interface DividerRendererProps {
  panel: DividerPanel;
}

export function DividerRenderer({ panel }: DividerRendererProps) {
  return (
    <DividerPanelView
      orientation={panel.config.orientation}
      weight={panel.config.weight ?? null}
      color={panel.config.color ?? null}
    />
  );
}
