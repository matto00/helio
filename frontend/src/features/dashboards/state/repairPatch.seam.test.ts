import fs from "node:fs";
import path from "node:path";

import { buildRepairPatch } from "./repairPatch";
import { dashboardGridCols } from "./dashboardLayout";
import { isLayoutValid } from "./breakpointLayout";
import type { DashboardLayout } from "../types/dashboard";
import type { Panel } from "../../panels/types/panel";

interface SeamCase {
  name: string;
  panels: string[];
  layout: DashboardLayout;
  expectedRepair: Partial<DashboardLayout>;
}

const fixture = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "../../../../../shared-test-fixtures/layout-repair-seam.json"),
    "utf8",
  ),
) as { cases: SeamCase[] };
const cases = fixture.cases;
const asPanels = (ids: string[]) => ids.map((id) => ({ id }) as Panel);

describe("stored-layout repair seam fixture (shared with the backend DashboardLayoutRepairSeamSpec)", () => {
  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const patch = buildRepairPatch(asPanels(c.panels), c.layout);
    expect(patch).toEqual(c.expectedRepair);
    expect(Object.keys(patch).length).toBeGreaterThan(0);
    for (const [bp, items] of Object.entries(patch)) {
      expect(isLayoutValid(items, dashboardGridCols[bp as keyof typeof dashboardGridCols]!)).toBe(
        true,
      );
    }
  });
});
