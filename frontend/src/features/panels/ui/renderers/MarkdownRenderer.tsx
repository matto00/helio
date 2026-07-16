import type { MappedPanelData, MarkdownPanel } from "../../types/panel";
import { MarkdownPanel as MarkdownPanelView } from "../MarkdownPanel";

interface MarkdownRendererProps {
  panel: MarkdownPanel;
  /** Bound markdown data, if the panel was fetched against a DataType. */
  data?: MappedPanelData | null;
}

export function MarkdownRenderer({ panel, data }: MarkdownRendererProps) {
  // Bound data path takes priority (Source mode); otherwise fall back to the
  // typed-config `content` field (Static mode). Mirrors `TextRenderer`.
  const content = (data?.content ?? panel.config.content) || null;
  return <MarkdownPanelView content={content} />;
}
