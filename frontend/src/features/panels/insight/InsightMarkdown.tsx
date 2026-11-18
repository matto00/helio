import { lazy, Suspense, type ReactNode } from "react";

import { PanelSuspenseFallback } from "../../../shared/ui/SuspenseFallback";

export interface InsightMarkdownProps {
  markdown: string;
  /** The citation ids of this render. */
  citations: readonly string[];
  /** The chip for a known citation id. */
  renderCitation: (id: string) => ReactNode;
}

// react-markdown is ESM-only and heavy: loaded on demand, in the markdown panel's chunk.
const View = lazy(() =>
  import("./InsightMarkdownView").then((m) => ({ default: m.InsightMarkdownView })),
);

/** HEL-1744 D5 -- the insight renderer: sanitised markdown whose `[cN]` markers (for citations of the render) are the chips
 *  `renderCitation` returns, and nothing else interactive (see `InsightMarkdownView`). */
export function InsightMarkdown(props: InsightMarkdownProps) {
  return (
    <Suspense fallback={<PanelSuspenseFallback />}>
      <View {...props} />
    </Suspense>
  );
}
