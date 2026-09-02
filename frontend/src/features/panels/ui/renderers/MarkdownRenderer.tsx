import { lazy, Suspense } from "react";

import { PanelSuspenseFallback } from "../../../../shared/ui/SuspenseFallback";

// HEL-512 — `react-markdown`/`remark-gfm` (see `MarkdownPanel.tsx`) is loaded via a dynamic
// `import()` so its module graph lands in a separate, non-entry chunk instead of the initial JS
// payload. `MarkdownPanel` is a named export (not default), so `React.lazy` — which requires a
// promise resolving to a `{ default }` shape — needs this adapter. See design.md Decision 1: only
// this internal import becomes lazy; `MarkdownRenderer`'s own export/signature (and
// `PanelContent.tsx`'s static import of it) are unchanged.
const MarkdownPanelView = lazy(() =>
  import("../MarkdownPanel").then((m) => ({ default: m.MarkdownPanel })),
);

interface MarkdownRendererProps {
  /** Literal markdown content — a `markdown`-kind panel's own `content`, or
   *  an output-kind panel's Output-fetched `MarkdownOutputConfig.content`.
   *  HEL-909 retired the bound/Source mode entirely (design.md's Axis B
   *  resolution) — this is always the literal path now. */
  content: string | null;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <Suspense fallback={<PanelSuspenseFallback />}>
      <MarkdownPanelView content={content} />
    </Suspense>
  );
}
