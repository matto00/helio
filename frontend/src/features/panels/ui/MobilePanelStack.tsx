// Read-only single-column panel stack rendered below the grid's `sm`
// container-width boundary (768px, `panelGridConfig.breakpoints.sm`).
//
// Structurally incapable of persisting layout (hazard §4.1 of
// notes/mobile-pwa-handoff.md, the binding spec): this file never imports
// `useLayoutSave` and holds no dispatch path to `updateDashboardLayout` or
// `setLayoutPending`. Do not add either import here — see `PanelGrid.tsx`'s
// class doc for why that guarantee matters.
//
// HEL-304: panel title/appearance edits made in `PanelDetailModal` here DO
// persist — they stage into `pendingPanelUpdates` and are flushed by
// `usePanelUpdatesFlush`, which `PanelGrid` mounts at every width. That flush
// path issues only panel-batch writes, never a dashboard-layout PATCH.
//
// Panels are ordered by the resolved `xs` layout (`y` then `x`,
// `orderPanelsForMobileStack`). Heights come from `mobilePanelHeights`
// (per-kind policy) — never the desktop `h × rowHeight` formula (W4.2/W4.3).

import { useCallback, useMemo, useState, type CSSProperties, type MouseEvent } from "react";

import { resolveDashboardLayout } from "../../dashboards/state/dashboardLayout";
import { formatRelativeTime } from "../../../utils/formatRelativeTime";
import { useTheme } from "../../../theme/ThemeProvider";
import type { DashboardLayout } from "../../dashboards/types/dashboard";
import type { Panel } from "../types/panel";
import { getPanelCardStyle, PanelCardBody } from "./PanelCard";
import { PanelDetailModal } from "./PanelDetailModal";
import { computeMobilePanelHeight, resolveStackContentWidth } from "./mobilePanelHeights";
import { orderPanelsForMobileStack } from "./panelGridConfig";
import "./PanelGrid.css";
import "./MobilePanelStack.css";

interface MobilePanelStackProps {
  panels: Panel[];
  layout: DashboardLayout;
  /** Measured grid-container width — the same value that gates this
   *  component's mount — reused so every stack item shares one width read
   *  instead of each re-measuring independently. */
  containerWidth: number;
}

export function MobilePanelStack({ panels, layout, containerWidth }: MobilePanelStackProps) {
  const { theme } = useTheme();
  const [detailPanelId, setDetailPanelId] = useState<string | null>(null);

  const resolvedLayout = useMemo(() => resolveDashboardLayout(panels, layout), [layout, panels]);
  const orderedPanels = useMemo(
    () => orderPanelsForMobileStack(panels, resolvedLayout.xs),
    [panels, resolvedLayout],
  );
  const contentWidth = useMemo(() => resolveStackContentWidth(containerWidth), [containerWidth]);

  const heightByPanelId = useMemo(() => {
    const layoutById = new Map(resolvedLayout.xs.map((item) => [item.panelId, item]));
    const map = new Map<string, ReturnType<typeof computeMobilePanelHeight>>();
    for (const panel of orderedPanels) {
      const h = layoutById.get(panel.id)?.h ?? 0;
      map.set(panel.id, computeMobilePanelHeight(panel.type, h, contentWidth));
    }
    return map;
  }, [orderedPanels, resolvedLayout, contentWidth]);

  // Mirrors DesktopPanelGrid's `handleCardClick`: tapping a nested
  // interactive element (the table's "Load more" button, an image link,
  // etc.) must not also open the detail modal.
  const handleItemClick = useCallback((panelId: string, e: MouseEvent<HTMLElement>) => {
    if ((e.target as Element).closest("button, input, a")) return;
    setDetailPanelId(panelId);
  }, []);

  const detailPanel = detailPanelId !== null ? panels.find((p) => p.id === detailPanelId) : null;

  return (
    <div className="mobile-panel-stack">
      {orderedPanels.map((panel) => {
        if (panel.type === "divider") {
          // W4.3: "no card chrome at all" — bare hairline, no header, no tap
          // target (a divider has no meaningful "details" to view).
          //
          // A stored `vertical` orientation is meaningless in a
          // single-column stack: `DividerPanel` sets an *inline*
          // `style={{ height: "100%" }}` for vertical dividers, which
          // resolves to 0px against the stack's auto-height flex item and
          // cannot be won back by any CSS override. Force horizontal here
          // instead of passing the panel's stored orientation straight
          // through — the intrinsic hairline W4.3 calls for.
          const stackPanel =
            panel.config.orientation === "vertical"
              ? { ...panel, config: { ...panel.config, orientation: "horizontal" } }
              : panel;
          return (
            <div
              key={panel.id}
              className="mobile-panel-stack__item mobile-panel-stack__item--divider"
            >
              <PanelCardBody panel={stackPanel} frozen={false} />
            </div>
          );
        }

        const heightPolicy = heightByPanelId.get(panel.id);
        const style: CSSProperties = {
          ...getPanelCardStyle(panel.appearance, theme),
          ...(heightPolicy?.height != null
            ? ({ "--mobile-panel-height": `${heightPolicy.height}px` } as CSSProperties)
            : {}),
        };

        return (
          <article
            key={panel.id}
            className={`panel-grid-card mobile-panel-stack__item mobile-panel-stack__item--${panel.type}`}
            style={style}
            onClick={(e) => handleItemClick(panel.id, e)}
          >
            <div className="mobile-panel-stack__header">
              <h3 className="panel-grid-card__title">{panel.title}</h3>
              {panel.dataAsOf ? (
                <p className="panel-grid-card__freshness">
                  Data as of {formatRelativeTime(panel.dataAsOf)}
                </p>
              ) : null}
            </div>
            <PanelCardBody panel={panel} frozen={false} compact />
          </article>
        );
      })}
      {detailPanel ? (
        // HEL-307: key by panel id so a direct switch between panels remounts
        // the modal subtree, re-seeding every `useState(initial*)` form field
        // from the target panel (see DesktopPanelGrid for the full rationale).
        <PanelDetailModal
          key={detailPanel.id}
          panel={detailPanel}
          onClose={() => setDetailPanelId(null)}
        />
      ) : null}
    </div>
  );
}
