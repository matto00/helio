import fs from "node:fs";
import path from "node:path";

import { dashboardGridCols } from "./dashboardLayout";
import { findOverlaps, isItemInBounds, isLayoutValid } from "./breakpointLayout";
import type { DashboardLayoutItem } from "../types/dashboard";

// The same fixture the backend `LayoutValidatorSpec` reads (HEL-1071): client and server must agree
// on bounds/overlap semantics and on the per-breakpoint column counts.
const FIXTURE_PATH = path.resolve(
  __dirname,
  "../../../../../shared-test-fixtures/layout-validity.json",
);

interface FixtureViolation {
  kind: "overlap" | "out_of_bounds";
  panelIds: string[];
}
interface FixtureCase {
  name: string;
  breakpoint: keyof typeof dashboardGridCols;
  items: DashboardLayoutItem[];
  valid: boolean;
  violations: FixtureViolation[];
}
interface Fixture {
  cols: Record<string, number>;
  cases: FixtureCase[];
}

const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf-8")) as Fixture;

/** Out-of-bounds items first (input order), then overlapping pairs: the fixture's canonical order. */
function violationsOf(items: DashboardLayoutItem[], cols: number): FixtureViolation[] {
  const oob = items
    .filter((item) => !isItemInBounds(item, cols))
    .map((item): FixtureViolation => ({ kind: "out_of_bounds", panelIds: [item.panelId] }));
  const overlaps = findOverlaps(items).map(
    ([a, b]): FixtureViolation => ({ kind: "overlap", panelIds: [a.panelId, b.panelId] }),
  );
  return [...oob, ...overlaps];
}

describe("shared layout-validity fixture (client/server parity)", () => {
  it("uses the column counts the grid uses", () => {
    expect(fixture.cols).toEqual(dashboardGridCols);
  });

  it("has cases", () => {
    expect(fixture.cases.length).toBeGreaterThan(0);
  });

  it.each(fixture.cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const cols = dashboardGridCols[c.breakpoint];
    expect(cols).toBe(fixture.cols[c.breakpoint]);
    expect(violationsOf(c.items, cols)).toEqual(c.violations);
    expect(isLayoutValid(c.items, cols)).toBe(c.valid);
  });
});
