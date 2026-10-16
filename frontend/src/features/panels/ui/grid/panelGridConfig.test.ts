import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getBreakpointFromWidth } from "react-grid-layout/core";

import {
  GRID_GUTTER_PX,
  itemsFromRglLayout,
  panelGridConfig,
  rglBreakpoints,
} from "./panelGridConfig";
import { makeOutputPanel } from "../../../../test/panelFixtures";

describe("rglBreakpoints (HEL-1023 boundary agreement)", () => {
  // RGL's own getBreakpointFromWidth is strict (`>`); PanelGrid's phone boundary and the documented
  // breakpoints are inclusive (`>=`). The raw config disagrees at the exact boundary widths.
  it("documents the library off-by-one this guards against", () => {
    expect(getBreakpointFromWidth(panelGridConfig.breakpoints, 1440)).toBe("md");
    expect(getBreakpointFromWidth(panelGridConfig.breakpoints, 768)).toBe("xs");
  });

  it.each([
    [1440, "lg"],
    [1439.9, "md"],
    [1100, "md"],
    [1099, "sm"],
    [768, "sm"],
    [767, "xs"],
    [0, "xs"],
    [4000, "lg"],
  ])("resolves a %ipx container to %s", (width, expected) => {
    expect(getBreakpointFromWidth(rglBreakpoints, width)).toBe(expected);
  });

  it("agrees with PanelGrid's phone boundary: 768px is never xs", () => {
    expect(getBreakpointFromWidth(rglBreakpoints, panelGridConfig.breakpoints.sm)).toBe("sm");
  });
});

describe("itemsFromRglLayout", () => {
  const a = makeOutputPanel({ id: "a" });
  const b = makeOutputPanel({ id: "b" });

  it("returns items in panel order and drops ids that are not live panels", () => {
    const items = itemsFromRglLayout(
      [a, b],
      [
        { i: "zz", x: 0, y: 0, w: 1, h: 1 },
        { i: "b", x: 2, y: 3, w: 4, h: 5 },
        { i: "a", x: 0, y: 0, w: 2, h: 2 },
      ],
    );
    expect(items).toEqual([
      { panelId: "a", x: 0, y: 0, w: 2, h: 2 },
      { panelId: "b", x: 2, y: 3, w: 4, h: 5 },
    ]);
  });
});

describe("grid gutter token (HEL-1576)", () => {
  const themeCss = readFileSync(join(__dirname, "../../../../theme/theme.css"), "utf8");

  it("--space-3 resolves to exactly GRID_GUTTER_PX (rem at the 16px root)", () => {
    const match = /--space-3:\s*([\d.]+)rem/.exec(themeCss);
    expect(match).not.toBeNull();
    expect(Number(match![1]) * 16).toBe(GRID_GUTTER_PX);
  });

  it("uses the gutter for both axes of the grid margin", () => {
    expect(panelGridConfig.margin).toEqual([GRID_GUTTER_PX, GRID_GUTTER_PX]);
  });
});
