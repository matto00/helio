import type { CSSProperties } from "react";

import { resolveDashboardLayout } from "../../../dashboards/state/dashboardLayout";
import type { DashboardLayout } from "../../../dashboards/types/dashboard";
import { computeMobilePanelHeight } from "./mobilePanelHeights";
import { buildSkeletonStubPanels } from "./panelGridSkeletonStubs";
import { Skeleton } from "../../../../shared/ui/Skeleton";

// A single documented neutral height (design.md D10's accepted per-card
// height delta on this surface only) — the real stack's per-card height
// depends on each panel's KIND (`mobilePanelHeights.ts`), which isn't known
// until the panels fetch resolves. `metric`'s fixed height is used as the
// neutral value because it's the one kind whose height doesn't also depend
// on the measured container width (unlike `chart`'s aspect-ratio height), so
// it stays stable across a resize while the skeleton is up.
const NEUTRAL_CARD_HEIGHT_PX = computeMobilePanelHeight("metric", 0, 0).height ?? 120;

interface MobilePanelStackSkeletonProps {
  layout: DashboardLayout;
}

/**
 * Initial-load placeholder for `MobilePanelStack` (HEL-528, design.md D10).
 * Reuses the real `.mobile-panel-stack`/`.mobile-panel-stack__item`/
 * `.panel-grid-card` classes for width/gap/padding parity, so only the
 * per-card HEIGHT is an accepted delta — never the horizontal geometry or
 * card count, both of which come from the same stub-building rule the
 * desktop grid skeleton uses (`panelGridSkeletonStubs.ts`), keyed to the
 * `xs` breakpoint since that's what the resolved stack always reads.
 */
export function MobilePanelStackSkeleton({ layout }: MobilePanelStackSkeletonProps) {
  const stubs = buildSkeletonStubPanels(layout, "xs");
  const resolvedLayout = resolveDashboardLayout(stubs, layout);
  const style = { "--mobile-panel-height": `${NEUTRAL_CARD_HEIGHT_PX}px` } as CSSProperties;

  return (
    <div className="mobile-panel-stack">
      {resolvedLayout.xs.map((item) => (
        <div
          key={item.panelId}
          className="panel-grid-card mobile-panel-stack__item mobile-panel-stack__item--metric"
          style={style}
          aria-hidden="true"
        >
          <div className="mobile-panel-stack__header">
            <Skeleton variant="line" width="60%" height="1.1em" />
          </div>
          <Skeleton variant="block" className="panel-grid-card__body-skeleton" />
        </div>
      ))}
    </div>
  );
}
