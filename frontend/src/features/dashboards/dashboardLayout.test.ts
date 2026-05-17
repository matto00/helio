import {
  areDashboardLayoutsEqual,
  createFallbackDashboardLayout,
  resolveDashboardLayout,
} from "./dashboardLayout";
import { makeMetricPanel } from "../../test/panelFixtures";

const makePanel = (id: string) =>
  makeMetricPanel({
    id,
    dashboardId: "dashboard-1",
    title: id,
    meta: {
      createdBy: "system",
      createdAt: "2026-03-14T00:00:00Z",
      lastUpdated: "2026-03-14T00:00:00Z",
    },
    appearance: { background: "transparent", color: "inherit", transparency: 0 },
  });

const panels = [makePanel("panel-1"), makePanel("panel-2")];

describe("dashboardLayout helpers", () => {
  it("creates responsive fallback layouts for all panels", () => {
    const layout = createFallbackDashboardLayout(panels);

    expect(layout.lg).toHaveLength(2);
    expect(layout.md).toHaveLength(2);
    expect(layout.sm).toHaveLength(2);
    expect(layout.xs).toHaveLength(2);
    expect(layout.lg[0]).toMatchObject({ panelId: "panel-1", x: 0, y: 0, w: 4, h: 5 });
  });

  it("merges saved layout items with fallbacks for missing panels", () => {
    const layout = resolveDashboardLayout(panels, {
      lg: [{ panelId: "panel-2", x: 6, y: 1, w: 5, h: 6 }],
      md: [],
      sm: [],
      xs: [],
    });

    expect(layout.lg[0]).toMatchObject({ panelId: "panel-1" });
    expect(layout.lg[1]).toMatchObject({ panelId: "panel-2", x: 6, y: 1, w: 5, h: 6 });
  });

  it("compares layouts by breakpoint item values", () => {
    const first = createFallbackDashboardLayout(panels);
    const second = createFallbackDashboardLayout(panels);
    const third = {
      ...second,
      lg: [{ ...second.lg[0], x: second.lg[0].x + 1 }, second.lg[1]],
    };

    expect(areDashboardLayoutsEqual(first, second)).toBe(true);
    expect(areDashboardLayoutsEqual(first, third)).toBe(false);
  });
});

describe("smart panel placement", () => {
  it("places the first panel at x=0, y=0 for all breakpoints", () => {
    const layout = createFallbackDashboardLayout([makePanel("p1")]);

    expect(layout.lg[0]).toMatchObject({ x: 0, y: 0 });
    expect(layout.md[0]).toMatchObject({ x: 0, y: 0 });
    expect(layout.sm[0]).toMatchObject({ x: 0, y: 0 });
    expect(layout.xs[0]).toMatchObject({ x: 0, y: 0 });
  });

  it("places the second panel beside the first on the lg breakpoint (x=4, y=0)", () => {
    const layout = createFallbackDashboardLayout([makePanel("p1"), makePanel("p2")]);

    expect(layout.lg[1]).toMatchObject({ panelId: "p2", x: 4, y: 0 });
  });

  it("wraps to a new row when the row is full (three 4-wide panels on 12-col grid)", () => {
    // lg: colCount=12, itemWidth=4 → 3 items per row
    const layout = createFallbackDashboardLayout([
      makePanel("p1"),
      makePanel("p2"),
      makePanel("p3"),
      makePanel("p4"),
    ]);

    // Row 0: p1@x=0, p2@x=4, p3@x=8 — row is full
    expect(layout.lg[0]).toMatchObject({ x: 0, y: 0 });
    expect(layout.lg[1]).toMatchObject({ x: 4, y: 0 });
    expect(layout.lg[2]).toMatchObject({ x: 8, y: 0 });
    // p4 wraps to row 1
    expect(layout.lg[3]).toMatchObject({ x: 0, y: 5 });
  });

  it("fills the next available slot in a partially-occupied row (sequential)", () => {
    // lg: colCount=12, itemWidth=4 → 3 items per row
    // Panels 1–4 fill row 0 (3 items) and start row 1.
    // Panel 5 should land at x=4, y=5 (next slot in row 1), not wrap to row 2.
    const layout = createFallbackDashboardLayout([
      makePanel("p1"),
      makePanel("p2"),
      makePanel("p3"),
      makePanel("p4"),
      makePanel("p5"),
    ]);

    // Row 0 full: p1@(0,0), p2@(4,0), p3@(8,0)
    // Row 1 partial: p4@(0,5), p5@(4,5)
    expect(layout.lg[3]).toMatchObject({ x: 0, y: 5 });
    expect(layout.lg[4]).toMatchObject({ x: 4, y: 5 });
  });

  it("fills an interior gap left by a removed panel via resolveDashboardLayout", () => {
    // lg: colCount=12, itemWidth=4 — 3 slots per row: x=0, x=4, x=8
    // Saved layout has p1@(0,0,4,5) and p3@(8,0,4,5); the middle slot (x=4,y=0) is empty.
    // p2 has no saved entry → resolveDashboardLayout generates a fallback that should land at x=4, y=0.
    const p1 = makePanel("p1");
    const p2 = makePanel("p2");
    const p3 = makePanel("p3");

    const resolved = resolveDashboardLayout([p1, p2, p3], {
      lg: [
        { panelId: "p1", x: 0, y: 0, w: 4, h: 5 },
        { panelId: "p3", x: 8, y: 0, w: 4, h: 5 },
      ],
      md: [],
      sm: [],
      xs: [],
    });

    // p1 and p3 keep their saved positions
    expect(resolved.lg.find((i) => i.panelId === "p1")).toMatchObject({ x: 0, y: 0 });
    expect(resolved.lg.find((i) => i.panelId === "p3")).toMatchObject({ x: 8, y: 0 });
    // p2 should fill the interior gap at x=4, y=0
    expect(resolved.lg.find((i) => i.panelId === "p2")).toMatchObject({ x: 4, y: 0 });
  });

  it("places a new panel without overlapping panels that have been moved from their fallback positions", () => {
    // lg colCount=12, itemWidth=4. Suppose existing panels p1, p2 were dragged to row 5
    // (positions a fresh fallback would never produce). Adding p3 with no saved entry
    // previously fell through to a from-scratch fallback that put p3 at (0,0,4,5) — fine.
    // But if p1 occupies (0,5) and p2 occupies (4,5), the fallback for p3 must consider
    // those actual positions before claiming a slot, and not collide with them.
    const p1 = makePanel("p1");
    const p2 = makePanel("p2");
    const p3 = makePanel("p3");
    const resolved = resolveDashboardLayout([p1, p2, p3], {
      lg: [
        { panelId: "p1", x: 0, y: 5, w: 4, h: 5 },
        { panelId: "p2", x: 4, y: 5, w: 4, h: 5 },
      ],
      md: [],
      sm: [],
      xs: [],
    });
    const placed = resolved.lg.find((i) => i.panelId === "p3")!;
    expect(
      resolved.lg
        .filter((i) => i.panelId !== "p3")
        .every(
          (i) =>
            !(
              placed.x < i.x + i.w &&
              placed.x + placed.w > i.x &&
              placed.y < i.y + i.h &&
              placed.y + placed.h > i.y
            ),
        ),
    ).toBe(true);
  });

  it("projects to a breakpoint with no saved entries instead of resetting all panels to top-left", () => {
    // User has lg layout saved with three panels at row 5 (after manual drag).
    // Resizing the viewport into md (no saved md layout) used to pack all panels at (0,0).
    // Expected: panels appear in roughly the same relative positions, scaled to md's 10 cols.
    const p1 = makePanel("p1");
    const p2 = makePanel("p2");
    const p3 = makePanel("p3");
    const resolved = resolveDashboardLayout([p1, p2, p3], {
      lg: [
        { panelId: "p1", x: 0, y: 5, w: 4, h: 5 },
        { panelId: "p2", x: 4, y: 5, w: 4, h: 5 },
        { panelId: "p3", x: 8, y: 5, w: 4, h: 5 },
      ],
      md: [],
      sm: [],
      xs: [],
    });
    // All three panels should retain y=5 (row preserved) and be horizontally distributed,
    // not all collapsed at (0,0).
    const ys = resolved.md.map((i) => i.y);
    expect(ys).toEqual([5, 5, 5]);
    const xs = resolved.md.map((i) => i.x).sort((a, b) => a - b);
    expect(xs[0]).toBe(0);
    expect(xs[2]).toBeGreaterThan(0);
  });

  it("places one 2-wide item per row on the xs breakpoint (colCount=2)", () => {
    // xs: colCount=2, itemWidth=2 → only 1 item per row
    const layout = createFallbackDashboardLayout([
      makePanel("p1"),
      makePanel("p2"),
      makePanel("p3"),
    ]);

    expect(layout.xs[0]).toMatchObject({ x: 0, y: 0 });
    expect(layout.xs[1]).toMatchObject({ x: 0, y: 5 });
    expect(layout.xs[2]).toMatchObject({ x: 0, y: 10 });
  });
});
