import type { DashboardLayout } from "../../../dashboards/types/dashboard";
import { DesktopPanelGridSkeleton } from "./DesktopPanelGridSkeleton";
import { MobilePanelStackSkeleton } from "./MobilePanelStackSkeleton";
import { panelGridConfig } from "./panelGridConfig";
import "./PanelGrid.css";

interface PanelGridSkeletonProps {
  layout: DashboardLayout;
  /** HEL-528 skeptic-final-1.md CR1 — see `PanelGrid.tsx`'s `width` prop doc.
   *  Sourced from the same `PanelList`-owned `useContainerWidth()` call
   *  `PanelGrid` now reads too, so the skeleton and the resolved grid it
   *  swaps into always agree on width — no independent re-measurement, no
   *  arrive-wide-then-settle shift. */
  width: number;
}

/**
 * Initial-load placeholder for `PanelGrid` (HEL-528, design.md D10). Mirrors
 * `PanelGrid.tsx`'s `breakpoints.sm` (768px) branch, using the SAME measured
 * container width `PanelList` passes to both, so the skeleton picks the same
 * desktop-grid-vs-phone-stack shape the resolved content will, rather than
 * guessing — and never disagrees with it on width.
 */
export function PanelGridSkeleton({ layout, width }: PanelGridSkeletonProps) {
  const isPhone = width < panelGridConfig.breakpoints.sm;

  return (
    <div className="panel-grid-shell" aria-label="Loading panels">
      {isPhone ? (
        <MobilePanelStackSkeleton layout={layout} />
      ) : (
        <DesktopPanelGridSkeleton layout={layout} width={width} />
      )}
    </div>
  );
}
