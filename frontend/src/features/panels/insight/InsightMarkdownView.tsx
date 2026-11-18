import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import type { ReactNode } from "react";

import { CITATION_ELEMENT, remarkCitationChips } from "./remarkCitationChips";
import type { InsightMarkdownProps } from "./InsightMarkdown";

/** The only elements an insight may render. Links, images, headings, tables and raw HTML are never in this list;
 *  `unwrapDisallowed` keeps their text, `skipHtml` drops raw HTML and `urlTransform` blanks every URL. */
const ALLOWED = [
  "p",
  "strong",
  "em",
  "ul",
  "ol",
  "li",
  "code",
  "br",
  "blockquote",
  CITATION_ELEMENT,
];

const noUrl = () => "";

/** HEL-1744 D5 -- react-markdown, sanitised. Loaded lazily (see `InsightMarkdown`), so its module graph shares the
 *  markdown panel's non-entry chunk. */
export function InsightMarkdownView({ markdown, citations, renderCitation }: InsightMarkdownProps) {
  const components = {
    [CITATION_ELEMENT]: (props: Record<string, unknown>): ReactNode =>
      renderCitation(String(props["data-citation"] ?? "")),
  } as Components;
  return (
    <div className="insight-markdown">
      <ReactMarkdown
        skipHtml
        allowedElements={ALLOWED}
        unwrapDisallowed
        urlTransform={noUrl}
        remarkPlugins={[[remarkCitationChips, { known: citations }]]}
        components={components}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
