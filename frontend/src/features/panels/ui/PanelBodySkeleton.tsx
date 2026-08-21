import { Skeleton } from "../../../shared/ui/Skeleton";
import "./PanelBodySkeleton.css";

/**
 * Kind-agnostic skeleton for a panel's data-loading body (HEL-528, design.md
 * D6). Shared by `PanelContent`'s loading branch and `PanelSuspenseFallback`
 * (the lazy-chunk fallback, `shared/ui/SuspenseFallback.tsx`) so a chunk-load
 * and a data-load stay visually indistinguishable inside the same panel card
 * — the HEL-512 invariant `SuspenseFallback.tsx` already documents.
 *
 * Deliberately NOT shaped per renderer type. `PanelSuspenseFallback` takes no
 * `panel` prop and cannot know the kind, and the two callers render into
 * different boxes — the data-load state replaces the whole panel body while
 * the chunk fallback sits nested inside the renderer's own canvas
 * (`ChartRenderer.tsx`'s `.chart-panel__canvas`) — so a kind-shaped skeleton
 * could not present identically in both. Fills its container; the container
 * itself (both callers' own wrapper) already establishes the box this needs
 * to fill.
 */
export function PanelBodySkeleton() {
  return (
    <div className="panel-body-skeleton">
      <Skeleton variant="block" className="panel-body-skeleton__block" />
    </div>
  );
}
