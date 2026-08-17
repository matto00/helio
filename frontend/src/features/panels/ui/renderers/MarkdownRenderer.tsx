import { lazy, Suspense } from "react";

import type { MappedPanelData, MarkdownPanel } from "../../types/panel";
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
  panel: MarkdownPanel;
  /** Bound markdown data, if the panel was fetched against a DataType. */
  data?: MappedPanelData | null;
}

export function MarkdownRenderer({ panel, data }: MarkdownRendererProps) {
  // Bound data path takes priority (Source mode); otherwise fall back to the
  // typed-config `content` field (Static mode). Mirrors `TextRenderer`.
  const content = (data?.content ?? panel.config.content) || null;
  return (
    <Suspense fallback={<PanelSuspenseFallback />}>
      <MarkdownPanelView content={content} />
    </Suspense>
  );
}
