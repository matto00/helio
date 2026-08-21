import "./SuspenseFallback.css";
import { Spinner } from "./Spinner";
import { PanelBodySkeleton } from "../../features/panels/ui/PanelBodySkeleton";

/** HEL-512 — Suspense fallback shown while a lazily-loaded panel-body module chunk (chart/
 *  markdown, see `ChartRenderer.tsx`/`MarkdownRenderer.tsx`) is still fetching. HEL-528 (design.md
 *  D6): renders the SAME kind-agnostic `PanelBodySkeleton` `PanelContent`'s own data-loading state
 *  uses, plus the identical `aria-label="Loading data"`, so a chunk-load and a data-load remain
 *  visually indistinguishable to the user — the invariant this component originally established
 *  with a shared `Spinner` recipe, now carried by the shared skeleton instead. Fills its parent's
 *  box (the renderer's own canvas/content wrapper already establishes the height). */
export function PanelSuspenseFallback() {
  return (
    <div className="suspense-fallback suspense-fallback--panel" aria-label="Loading data">
      <PanelBodySkeleton />
    </div>
  );
}

/** HEL-512 — Suspense fallback for a lazily-loaded route (e.g. Proposal Review, see
 *  `AppRoutes.tsx`). Centered within the `.app-content` route outlet rather than a single panel
 *  body — larger spinner, no visible label (matches `ProtectedRoute`'s boot-gate pattern). */
export function PageSuspenseFallback() {
  return (
    <div className="suspense-fallback suspense-fallback--page" aria-label="Loading">
      <Spinner size="2xl" />
    </div>
  );
}
