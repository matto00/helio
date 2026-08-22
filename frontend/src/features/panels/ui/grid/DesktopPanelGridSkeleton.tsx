import { Responsive } from "react-grid-layout";
import { getBreakpointFromWidth } from "react-grid-layout/core";

import {
  resolveDashboardLayout,
  type DashboardLayoutBreakpoint,
} from "../../../dashboards/state/dashboardLayout";
import type { DashboardLayout } from "../../../dashboards/types/dashboard";
import { PanelCardSkeleton } from "../PanelCardSkeleton";
import { buildSkeletonStubPanels } from "./panelGridSkeletonStubs";
import { createLayouts, panelGridConfig } from "./panelGridConfig";

interface DesktopPanelGridSkeletonProps {
  layout: DashboardLayout;
  /** Grid container width, measured by the parent `PanelGridSkeleton` —
   *  mirrors `DesktopPanelGrid`'s own `width` prop. */
  width: number;
}

/**
 * Initial-load placeholder for `DesktopPanelGrid` (HEL-528, design.md D10).
 * Mounts the SAME `Responsive` grid component and `panelGridConfig` the real
 * grid uses — not a hand-rolled re-implementation of its pixel math — with
 * `dragConfig`/`resizeConfig` disabled (a static placeholder has no handle
 * elements for either to attach to regardless) and `PanelCardSkeleton`
 * children in place of `PanelCard`. Card geometry is therefore pixel-exact by
 * construction; see `panelGridSkeletonStubs.ts` for how the placeholder
 * panel-id stand-ins are chosen.
 */
export function DesktopPanelGridSkeleton({ layout, width }: DesktopPanelGridSkeletonProps) {
  // `panelGridConfig.breakpoints`'s type is the generic `Breakpoints<string>`
  // (matching `ResponsiveGridLayoutProps`'s own default), so the library
  // widens its return type to `string` — but its four keys ARE exactly
  // `DashboardLayoutBreakpoint`'s union (`panelGridConfig.ts`'s own object
  // literal), so this narrows back a known-safe shape rather than an
  // arbitrary assertion.
  const activeBreakpoint = getBreakpointFromWidth(
    panelGridConfig.breakpoints,
    width,
  ) as DashboardLayoutBreakpoint;
  const stubs = buildSkeletonStubPanels(layout, activeBreakpoint);
  const resolvedLayout = resolveDashboardLayout(stubs, layout);
  const layouts = createLayouts(resolvedLayout);

  return (
    <Responsive
      className="panel-grid"
      width={width}
      layouts={layouts}
      breakpoints={panelGridConfig.breakpoints}
      cols={panelGridConfig.cols}
      rowHeight={panelGridConfig.rowHeight}
      margin={panelGridConfig.margin}
      containerPadding={panelGridConfig.containerPadding}
      dragConfig={{ enabled: false }}
      resizeConfig={{ enabled: false }}
    >
      {stubs.map((stub) => (
        <div key={stub.id}>
          <PanelCardSkeleton />
        </div>
      ))}
    </Responsive>
  );
}
