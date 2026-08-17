import "./SuspenseFallback.css";
import { Spinner } from "./Spinner";

/** HEL-512 — Suspense fallback shown while a lazily-loaded panel-body module chunk (chart/
 *  markdown, see `ChartRenderer.tsx`/`MarkdownRenderer.tsx`) is still fetching. Deliberately
 *  mirrors `PanelContent`'s own data-loading state (`Spinner size="xl"` + a visible "Loading..."
 *  label + `aria-label="Loading data"`) so a chunk-load and a data-load are visually
 *  indistinguishable to the user (design.md Decision 3). Fills its parent's box (the renderer's
 *  own canvas/content wrapper already establishes the height). */
export function PanelSuspenseFallback() {
  return (
    <div className="suspense-fallback suspense-fallback--panel" aria-label="Loading data">
      <Spinner size="xl" />
      <span className="suspense-fallback__label">Loading...</span>
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
