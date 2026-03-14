import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import type { CSSProperties } from "react";
import { Responsive, type ResponsiveGridLayoutProps, useContainerWidth } from "react-grid-layout";

import { buildPanelSurface, resolvePanelTextColor } from "../theme/appearance";
import { useTheme } from "../theme/ThemeProvider";
import type { Panel } from "../types/models";
import { PanelAppearanceEditor } from "./PanelAppearanceEditor";
import "./PanelGrid.css";

interface PanelGridConfig {
  breakpoints: NonNullable<ResponsiveGridLayoutProps["breakpoints"]>;
  cols: NonNullable<ResponsiveGridLayoutProps["cols"]>;
  rowHeight: number;
  margin: readonly [number, number];
  containerPadding: readonly [number, number];
  initialWidth: number;
  itemHeights: {
    default: number;
    min: number;
  };
}

const panelGridConfig: PanelGridConfig = {
  breakpoints: {
    lg: 1440,
    md: 1100,
    sm: 768,
    xs: 0,
  },
  cols: {
    lg: 12,
    md: 10,
    sm: 6,
    xs: 2,
  },
  rowHeight: 52,
  margin: [18, 18],
  containerPadding: [0, 0],
  initialWidth: 1280,
  itemHeights: {
    default: 5,
    min: 4,
  },
};

function createBaseLayout(
  panels: Panel[],
  colCount: number,
): NonNullable<ResponsiveGridLayoutProps["layouts"]>[string] {
  const itemWidth = colCount >= 10 ? 4 : colCount >= 6 ? 3 : 2;
  const itemHeight = panelGridConfig.itemHeights.default;
  const itemsPerRow = Math.max(1, Math.floor(colCount / itemWidth));

  return panels.map((panel, index) => ({
    i: panel.id,
    x: (index % itemsPerRow) * itemWidth,
    y: Math.floor(index / itemsPerRow) * itemHeight,
    w: itemWidth,
    h: itemHeight,
    minW: Math.min(2, itemWidth),
    minH: panelGridConfig.itemHeights.min,
  }));
}

function createLayouts(panels: Panel[]): NonNullable<ResponsiveGridLayoutProps["layouts"]> {
  return {
    lg: createBaseLayout(panels, panelGridConfig.cols.lg),
    md: createBaseLayout(panels, panelGridConfig.cols.md),
    sm: createBaseLayout(panels, panelGridConfig.cols.sm),
    xs: createBaseLayout(panels, panelGridConfig.cols.xs),
  };
}

interface PanelGridProps {
  panels: Panel[];
}

function getPanelCardStyle(panel: Panel, theme: "dark" | "light"): CSSProperties {
  const style = {} as CSSProperties & Record<string, string>;
  const panelSurface = buildPanelSurface(
    theme,
    panel.appearance.background,
    panel.appearance.transparency,
  );
  style["--panel-surface-override"] = panelSurface;
  style["--panel-text-override"] = resolvePanelTextColor(
    theme,
    panel.appearance.background,
    panel.appearance.transparency,
    panel.appearance.color,
  );

  return style;
}

export function PanelGrid({ panels }: PanelGridProps) {
  const { theme } = useTheme();
  const { containerRef, width } = useContainerWidth({
    initialWidth: panelGridConfig.initialWidth,
  });
  const layouts = createLayouts(panels);

  return (
    <div ref={containerRef} className="panel-grid-shell">
      <Responsive
        className="panel-grid"
        width={width}
        layouts={layouts}
        breakpoints={panelGridConfig.breakpoints}
        cols={panelGridConfig.cols}
        rowHeight={panelGridConfig.rowHeight}
        margin={panelGridConfig.margin}
        containerPadding={panelGridConfig.containerPadding}
        dragConfig={{ handle: ".panel-grid-card__handle" }}
      >
        {panels.map((panel) => (
          <div key={panel.id}>
            <article className="panel-grid-card" style={getPanelCardStyle(panel, theme)}>
              <div className="panel-grid-card__top">
                <div>
                  <h3 className="panel-grid-card__title">{panel.title}</h3>
                </div>
                <div className="panel-grid-card__actions">
                  <PanelAppearanceEditor panel={panel} />
                  <button
                    type="button"
                    className="panel-grid-card__handle"
                    aria-label={`Move ${panel.title} panel`}
                  >
                    <span />
                    <span />
                  </button>
                </div>
              </div>
              <p className="panel-grid-card__copy">
                Starter grid placement is live now so future tickets can add richer panel content,
                saved layouts, and deeper customization without replacing the layout foundation.
              </p>
              <div className="panel-grid-card__footer">
                <span>Updated {new Date(panel.meta.lastUpdated).toLocaleDateString()}</span>
              </div>
            </article>
          </div>
        ))}
      </Responsive>
    </div>
  );
}
