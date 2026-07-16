import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./MarkdownPanel.css";
import { resolveMarkdownUrl } from "./markdownUrls";

interface MarkdownPanelProps {
  content: string | null;
}

export function MarkdownPanel({ content }: MarkdownPanelProps) {
  if (!content) {
    return (
      <div className="markdown-panel markdown-panel--empty">
        <span className="markdown-panel__placeholder">
          No content yet. Open panel settings to add markdown.
        </span>
      </div>
    );
  }

  return (
    <div className="markdown-panel">
      <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={resolveMarkdownUrl}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
