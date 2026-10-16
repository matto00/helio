import { render } from "@testing-library/react";

import { ThemeProvider } from "../../../../theme/ThemeProvider";
import type { Density } from "../../../../theme/appearancePrefs";
import type { DashboardLayout } from "../../../dashboards/types/dashboard";
import { DesktopPanelGridSkeleton } from "./DesktopPanelGridSkeleton";
import { COMPACT_GRID_GUTTER_PX, GRID_GUTTER_PX, gridMetrics } from "./panelGridConfig";

// HEL-1572: the real react-grid-layout positions the placeholder cards, so this measures the actual geometry the
// density switch produces (no RGL mock).
const layout: DashboardLayout = {
  lg: [
    { panelId: "a", x: 0, y: 0, w: 6, h: 5 },
    { panelId: "b", x: 6, y: 0, w: 6, h: 5 },
    { panelId: "c", x: 0, y: 5, w: 12, h: 6 },
    { panelId: "d", x: 0, y: 11, w: 4, h: 4 },
  ],
  md: [],
  sm: [],
  xs: [],
};

interface Box {
  top: number;
  left: number;
  height: number;
  width: number;
}

function measure(density: Density): Box[] {
  const { container, unmount } = render(
    <ThemeProvider preferredAppearance={{ typeStyle: "sans", density, motion: null }}>
      <DesktopPanelGridSkeleton layout={layout} width={1600} />
    </ThemeProvider>,
  );
  const boxes = [...container.querySelectorAll<HTMLElement>(".react-grid-item")].map((el) => {
    const match = /translate\(([\d.]+)px,\s*([\d.]+)px\)/.exec(el.style.transform);
    return {
      left: Number(match?.[1]),
      top: Number(match?.[2]),
      height: parseFloat(el.style.height),
      width: parseFloat(el.style.width),
    };
  });
  unmount();
  return boxes;
}

describe("density geometry (HEL-1572)", () => {
  it("Comfortable uses the default gutter and rowHeight 52; Compact 8px with the derived rowHeight", () => {
    expect(gridMetrics("comfortable")).toEqual({
      rowHeight: 52,
      margin: [GRID_GUTTER_PX, GRID_GUTTER_PX],
    });
    expect(gridMetrics("compact")).toEqual({
      rowHeight: 52 + (GRID_GUTTER_PX - COMPACT_GRID_GUTTER_PX),
      margin: [COMPACT_GRID_GUTTER_PX, COMPACT_GRID_GUTTER_PX],
    });
  });

  it("panel tops are identical across densities and every height grows by exactly the gutter difference", () => {
    const comfortable = measure("comfortable");
    const compact = measure("compact");
    expect(comfortable.length).toBe(4);
    expect(compact.length).toBe(4);
    // Non-vacuity: the panels really are laid out one above another, not all at zero.
    expect(comfortable.map((b) => b.top)).toEqual(
      [...comfortable.map((b) => b.top)].sort((a, b) => a - b),
    );
    expect(new Set(comfortable.map((b) => b.top)).size).toBeGreaterThan(2);
    const gutterDifference = GRID_GUTTER_PX - COMPACT_GRID_GUTTER_PX;
    comfortable.forEach((box, i) => {
      expect(compact[i].top).toBe(box.top);
      expect(compact[i].height).toBe(box.height + gutterDifference);
    });
  });

  it("the horizontal gutter follows the density (column pitch differs, rows are not shifted)", () => {
    const comfortable = measure("comfortable");
    const compact = measure("compact");
    // Panel b starts after panel a plus one gutter: its left edge moves left by the horizontal-gutter share.
    expect(compact[1].left).toBeLessThan(comfortable[1].left);
  });
});
