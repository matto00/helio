import { Suspense, useCallback, useLayoutEffect, useState, type ReactNode } from "react";

import "./SuspenseFallback.css";
import { Crossfade } from "./Crossfade";
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

/** Fires `onReady` in the first layout effect of its subtree. Inside a Suspense boundary that effect runs only once the
 *  boundary has committed its primary children, i.e. once every lazy chunk below has resolved. */
function ReadySignal({ onReady, children }: { onReady: () => void; children: ReactNode }) {
  useLayoutEffect(() => {
    onReady();
  }, [onReady]);
  return <>{children}</>;
}

/** HEL-1584 D6 -- a route-level Suspense boundary whose loading fallback crossfades into the loaded route. The route is
 *  mounted from the start, invisible and inert inside the `Crossfade` (`keepContentMounted`), so its own Suspense boundary
 *  can resolve; the first commit of its content flips the crossfade. A route whose chunk is already cached resolves before
 *  the fallback paints, and the `Crossfade` then swaps with no fade at all. `block` keeps the page at the outlet's full
 *  width. Give each route boundary its own `key`: React Router renders every route's element at the same tree position, so
 *  without one a navigation between two lazy routes would reuse a boundary that has already flipped to ready. */
export function RouteSuspense({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const onReady = useCallback(() => setReady(true), []);
  return (
    <Crossfade loading={!ready} skeleton={<PageSuspenseFallback />} keepContentMounted block>
      <Suspense fallback={null}>
        <ReadySignal onReady={onReady}>{children}</ReadySignal>
      </Suspense>
    </Crossfade>
  );
}
