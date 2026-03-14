import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import { useState } from "react";
import {
  Responsive,
  type Layout,
  type LayoutItem,
  type ResponsiveLayouts,
  type ResponsiveGridLayoutProps,
  useContainerWidth,
} from "react-grid-layout";

import type { Panel } from "../types/models";
import "./PanelGrid.css";

const breakpoints: ResponsiveGridLayoutProps["breakpoints"] = {
  lg: 1440,
  md: 1100,
  sm: 768,
  xs: 0,
};

const cols: ResponsiveGridLayoutProps["cols"] = {
  lg: 12,
  md: 10,
  sm: 6,
  xs: 2,
};

function createBaseLayout(panels: Panel[], colCount: number): Layout {
  const itemWidth = colCount >= 10 ? 4 : colCount >= 6 ? 3 : 2;
  const itemHeight = 4;
  const itemsPerRow = Math.max(1, Math.floor(colCount / itemWidth));

  return panels.map((panel, index) => ({
    i: panel.id,
    x: (index % itemsPerRow) * itemWidth,
    y: Math.floor(index / itemsPerRow) * itemHeight,
    w: itemWidth,
    h: itemHeight,
    minW: Math.min(2, itemWidth),
    minH: 3,
  }));
}

function createLayouts(panels: Panel[]): ResponsiveLayouts<string> {
  return {
    lg: createBaseLayout(panels, cols?.lg ?? 12),
    md: createBaseLayout(panels, cols?.md ?? 10),
    sm: createBaseLayout(panels, cols?.sm ?? 6),
    xs: createBaseLayout(panels, cols?.xs ?? 2),
  };
}

function mergeLayouts(
  currentLayouts: ResponsiveLayouts<string>,
  panels: Panel[],
): ResponsiveLayouts<string> {
  const panelIds = new Set(panels.map((panel) => panel.id));
  const nextLayouts = createLayouts(panels);

  for (const breakpoint of Object.keys(nextLayouts) as Array<keyof ResponsiveLayouts<string>>) {
    const currentLayout = currentLayouts[breakpoint] ?? [];
    const defaultLayout = nextLayouts[breakpoint] ?? [];
    const defaultsById = new Map<string, LayoutItem>(
      defaultLayout.map((layout: LayoutItem) => [layout.i, layout]),
    );

    nextLayouts[breakpoint] = currentLayout
      .filter((layout: LayoutItem) => panelIds.has(layout.i))
      .map((layout: LayoutItem) => ({
        ...(defaultsById.get(layout.i) ?? {}),
        ...layout,
      }));

    for (const panel of panels) {
      if (nextLayouts[breakpoint]?.some((layout: LayoutItem) => layout.i === panel.id)) {
        continue;
      }

      const fallbackLayout = defaultsById.get(panel.id);
      if (fallbackLayout) {
        nextLayouts[breakpoint] = [...(nextLayouts[breakpoint] ?? []), fallbackLayout];
      }
    }
  }

  return nextLayouts;
}

interface PanelGridProps {
  panels: Panel[];
}

export function PanelGrid({ panels }: PanelGridProps) {
  const [layouts, setLayouts] = useState<ResponsiveLayouts<string>>(() => createLayouts(panels));
  const { containerRef, width } = useContainerWidth({ initialWidth: 1280 });

  return (
    <div ref={containerRef} className="panel-grid-shell">
      <Responsive
        className="panel-grid"
        width={width}
        layouts={layouts}
        breakpoints={breakpoints}
        cols={cols}
        rowHeight={52}
        margin={[18, 18]}
        containerPadding={[0, 0]}
        dragConfig={{ handle: ".panel-grid-card__handle" }}
        onLayoutChange={(_layout: Layout, allLayouts: ResponsiveLayouts<string>) =>
          setLayouts(mergeLayouts(allLayouts, panels))
        }
      >
        {panels.map((panel) => (
          <div key={panel.id}>
            <article className="panel-grid-card">
              <div className="panel-grid-card__top">
                <div>
                  <span className="panel-grid-card__eyebrow">Live panel</span>
                  <h3 className="panel-grid-card__title">{panel.title}</h3>
                </div>
                <button
                  type="button"
                  className="panel-grid-card__handle"
                  aria-label={`Move ${panel.title} panel`}
                >
                  <span />
                  <span />
                </button>
              </div>
              <p className="panel-grid-card__copy">
                Starter grid placement is live now so future tickets can add richer panel content,
                saved layouts, and deeper customization without replacing the layout foundation.
              </p>
              <div className="panel-grid-card__footer">
                <span>{new Date(panel.meta.lastUpdated).toLocaleDateString()}</span>
                <span>Resizable foundation</span>
              </div>
            </article>
          </div>
        ))}
      </Responsive>
    </div>
  );
}
