import type { MarkdownPanel } from "../../types/panel";
import { MarkdownPanel as MarkdownPanelView } from "../MarkdownPanel";

interface MarkdownRendererProps {
  panel: MarkdownPanel;
}

export function MarkdownRenderer({ panel }: MarkdownRendererProps) {
  return <MarkdownPanelView content={panel.config.content || null} />;
}
