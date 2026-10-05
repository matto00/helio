import fs from "node:fs";
import path from "node:path";

import { buildLayoutPatch } from "./layoutPatch";
import { dashboardGridCols, resolveDashboardLayout } from "./dashboardLayout";
import { breakpointOrder, isLayoutValid } from "./breakpointLayout";
import type { DashboardLayout } from "../types/dashboard";
import type { Panel } from "../../panels/types/panel";

interface CreateSeamFixture {
  cases: { name: string; panels: string[]; layout: DashboardLayout }[];
  pendingDrag: {
    panels: string[];
    stored: DashboardLayout;
    local: DashboardLayout;
    patch: Partial<DashboardLayout>;
  };
}

const fixture = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "../../../../../shared-test-fixtures/layout-create-seam.json"),
    "utf8",
  ),
) as CreateSeamFixture;
const asPanels = (ids: string[]) => ids.map((id) => ({ id }) as Panel);

describe("panel create seam fixture (shared with the backend PanelCreateSeamSpec)", () => {
  it.each(fixture.cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    for (const bp of breakpointOrder) {
      expect(isLayoutValid(c.layout[bp], dashboardGridCols[bp] ?? 0)).toBe(true);
      expect(c.layout[bp].map((i) => i.panelId).sort()).toEqual([...c.panels].sort());
    }
    const panels = asPanels(c.panels);
    expect(resolveDashboardLayout(panels, c.layout)).toEqual(c.layout);
    expect(buildLayoutPatch(c.layout, c.layout, resolveDashboardLayout(panels, c.layout))).toEqual(
      {},
    );
  });

  it("a create landing under a pending local drag sends only valid breakpoints", () => {
    const { panels, stored, local, patch } = fixture.pendingDrag;
    const resolved = resolveDashboardLayout(asPanels(panels), local);
    const built = buildLayoutPatch(local, stored, resolved);
    expect(built).toEqual(patch);
    for (const [bp, items] of Object.entries(built)) {
      expect(
        isLayoutValid(items, dashboardGridCols[bp as keyof typeof dashboardGridCols] ?? 0),
      ).toBe(true);
    }
  });
});
