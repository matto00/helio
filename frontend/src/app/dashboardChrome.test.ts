import { isDashboardViewPath } from "../shared/chrome/sections";
import { usesDashboardMetaRow, usesDashboardTabBar } from "./dashboardChrome";

describe("usesDashboardMetaRow", () => {
  it.each(["/dashboards", "/dashboards/d1"])(
    "is true on the rail-shell dashboard view %s",
    (path) => {
      expect(usesDashboardMetaRow(path, false)).toBe(true);
    },
  );

  it.each(["/dashboards/d1", "/dashboards"])("is false on the phone shell (%s)", (path) => {
    expect(usesDashboardMetaRow(path, true)).toBe(false);
  });

  it("is false on Home (HEL-1578): Home is not the dashboard view", () => {
    expect(usesDashboardMetaRow("/home", false)).toBe(false);
    expect(usesDashboardTabBar("/home", false)).toBe(false);
  });

  it.each(["/sources", "/pipelines", "/pipelines/p1", "/chat", "/settings", "/outputs"])(
    "is false off the dashboard view (%s)",
    (path) => {
      expect(usesDashboardMetaRow(path, false)).toBe(false);
    },
  );

  it("is exactly the shared dashboard-view predicate on the rail shell", () => {
    for (const path of ["/home", "/dashboards/x", "/sources", "/", "/dashboards"]) {
      expect(usesDashboardMetaRow(path, false)).toBe(isDashboardViewPath(path));
    }
  });
});

describe("usesDashboardTabBar", () => {
  it("shares the rail-shell dashboard-view condition with the meta row", () => {
    for (const path of [
      "/home",
      "/dashboards/x",
      "/sources",
      "/pipelines/p1",
      "/",
      "/dashboards",
    ]) {
      for (const phone of [false, true]) {
        expect(usesDashboardTabBar(path, phone)).toBe(usesDashboardMetaRow(path, phone));
      }
    }
  });

  it("is false on the phone shell and off the dashboard view", () => {
    expect(usesDashboardTabBar("/dashboards/d1", true)).toBe(false);
    expect(usesDashboardTabBar("/sources", false)).toBe(false);
    expect(usesDashboardTabBar("/dashboards/d1", false)).toBe(true);
  });
});
