import { resolveDashboardLayout } from "../../../dashboards/state/dashboardLayout";
import type { DashboardLayout } from "../../../dashboards/types/dashboard";
import { buildSkeletonStubPanels, FALLBACK_STUB_COUNT } from "./panelGridSkeletonStubs";

const emptyLayout: DashboardLayout = { lg: [], md: [], sm: [], xs: [] };

describe("buildSkeletonStubPanels + resolveDashboardLayout (design.md D10)", () => {
  it("D10 scenario 1 — a fully covered saved layout produces an exact match: one stub per entry, at that entry's own position and size", () => {
    const saved: DashboardLayout = {
      ...emptyLayout,
      lg: [
        { panelId: "p1", x: 0, y: 0, w: 4, h: 5 },
        { panelId: "p2", x: 4, y: 0, w: 8, h: 6 },
        { panelId: "p3", x: 0, y: 5, w: 3, h: 4 },
      ],
    };

    const stubs = buildSkeletonStubPanels(saved, "lg");
    expect(stubs).toHaveLength(3);

    const resolved = resolveDashboardLayout(stubs, saved).lg;
    expect(resolved).toHaveLength(3);
    // Verbatim, in saved order — the resolver's exact-match shortcut.
    expect(resolved).toEqual(saved.lg);
  });

  it("D10 scenario 2 — an empty saved layout everywhere still renders a non-zero count at the resolver's own default geometry", () => {
    const stubs = buildSkeletonStubPanels(emptyLayout, "lg");
    expect(stubs).toHaveLength(FALLBACK_STUB_COUNT);

    const resolved = resolveDashboardLayout(stubs, emptyLayout).lg;
    expect(resolved).toHaveLength(FALLBACK_STUB_COUNT);
    // defaultItemWidth(12) === 4 (dashboardLayout.ts) — packed left-to-right,
    // non-overlapping, via findNextAvailablePosition.
    expect(resolved[0]).toMatchObject({ x: 0, y: 0, w: 4, h: 5 });
    expect(resolved[1]).toMatchObject({ x: 4, y: 0, w: 4, h: 5 });
    expect(resolved[2]).toMatchObject({ x: 8, y: 0, w: 4, h: 5 });
  });

  it("D10 scenario 3 — an empty active breakpoint projected from a populated one is matched, not read from the empty saved array", () => {
    const saved: DashboardLayout = {
      ...emptyLayout,
      lg: [
        { panelId: "p1", x: 0, y: 0, w: 4, h: 5 },
        { panelId: "p2", x: 4, y: 0, w: 4, h: 5 },
        { panelId: "p3", x: 8, y: 0, w: 4, h: 5 },
        { panelId: "p4", x: 0, y: 5, w: 4, h: 5 },
      ],
      // xs (2 cols) has no entries of its own.
    };

    const stubs = buildSkeletonStubPanels(saved, "xs");
    // Capped at FALLBACK_STUB_COUNT even though the source breakpoint has 4.
    expect(stubs).toHaveLength(FALLBACK_STUB_COUNT);

    const resolvedXs = resolveDashboardLayout(stubs, saved).xs;
    expect(resolvedXs).toHaveLength(FALLBACK_STUB_COUNT);
    // Every returned placeholder's id must be one of the FIRST 3 lg panelIds,
    // and its geometry must equal what `resolveDashboardLayout` itself
    // projects for that id at xs — i.e. not the resolver's independent
    // default-packed fallback (which would look identical in shape but is
    // the wrong code path — this assertion is really about which stub IDs
    // were chosen, verified indirectly by requiring a real match per id).
    const expectedIds = saved.lg.slice(0, FALLBACK_STUB_COUNT).map((item) => item.panelId);
    expect(resolvedXs.map((item) => item.panelId).sort()).toEqual(expectedIds.sort());
    for (const item of resolvedXs) {
      // xs has 2 cols; every projected item must fit inside it.
      expect(item.x + item.w).toBeLessThanOrEqual(2);
    }
  });

  it("uses synthetic ids only when no breakpoint anywhere has saved entries", () => {
    const stubs = buildSkeletonStubPanels(emptyLayout, "sm");
    for (const stub of stubs) {
      expect(stub.id).toMatch(/^skeleton-stub-\d+$/);
    }
  });

  it("never returns zero stubs, regardless of saved-layout shape", () => {
    expect(buildSkeletonStubPanels(emptyLayout, "lg").length).toBeGreaterThan(0);
    expect(
      buildSkeletonStubPanels(
        { ...emptyLayout, md: [{ panelId: "only", x: 0, y: 0, w: 4, h: 5 }] },
        "xs",
      ).length,
    ).toBeGreaterThan(0);
  });
});
