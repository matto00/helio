import { isDestinationActive, navDestinations, phoneNavTabs } from "./navDestinations";

// Locks the shared source of truth both the desktop sidebar (`App.tsx`) and
// the phone `BottomNav` map over — a change here is a change to both
// surfaces at once, which is the whole point of task 1.2/1.3 (see
// App.test.tsx's "Main navigation" assertions for the desktop side, and
// BottomNav.test.tsx for the phone side; both must agree with this list).
//
// HEL-909: Data Types (/registry) and Metrics (/metrics) are retired
// outright — nav collapses from 7 to 5 destinations.
describe("navDestinations", () => {
  it("lists the five top-level sections in sidebar order with matching labels", () => {
    expect(navDestinations.map((d) => d.label)).toEqual([
      "Dashboards",
      "Data Sources",
      "Data Pipelines",
      "Connectors",
      "Assistant",
    ]);
  });

  it("lists the matching route paths", () => {
    expect(navDestinations.map((d) => d.to)).toEqual([
      "/dashboards",
      "/sources",
      "/pipelines",
      "/connectors",
      "/chat",
    ]);
  });

  it("marks only the Dashboards destination as an exact ('end') route match", () => {
    const dashboards = navDestinations.find((d) => d.to === "/dashboards");
    expect(dashboards?.end).toBe(true);
    for (const destination of navDestinations.filter((d) => d.to !== "/dashboards")) {
      expect(destination.end).not.toBe(true);
    }
  });

  it("gives every destination a distinct Lucide icon component", () => {
    const icons = new Set(navDestinations.map((d) => d.icon));
    expect(icons.size).toBe(navDestinations.length);
  });
});

// HEL-1583: the phone tab list is a derivation of the shared destinations, never a parallel registry.
describe("phoneNavTabs", () => {
  it("lists Home, Dashboards, Data, Pipelines and Me, in order", () => {
    expect(phoneNavTabs.map((tab) => tab.label)).toEqual([
      "Home",
      "Dashboards",
      "Data",
      "Pipelines",
      "Me",
    ]);
  });

  it("reuses the shared route paths and keeps the registry labels untouched", () => {
    const routes = phoneNavTabs.filter((tab) => tab.kind === "route");
    expect(routes.map((tab) => tab.to)).toEqual(["/home", "/dashboards", "/sources", "/pipelines"]);
    expect(navDestinations.map((d) => d.label)).toContain("Data Sources");
    expect(navDestinations.map((d) => d.label)).toContain("Data Pipelines");
  });

  it("makes Me a menu with no route of its own", () => {
    const me = phoneNavTabs[phoneNavTabs.length - 1];
    expect(me.kind).toBe("menu");
    expect("to" in me).toBe(false);
    expect(me.activePrefixes).toEqual(["/settings", "/admin/usage"]);
  });

  it("gives the desktop rail's destinations no activePrefixes (the rail is unchanged)", () => {
    for (const destination of navDestinations) {
      expect(destination.activePrefixes).toBeUndefined();
    }
  });
});

describe("isDestinationActive with activePrefixes", () => {
  const data = phoneNavTabs[2];
  const me = phoneNavTabs[4];
  it("treats Data as current on /sources and /connectors trees only", () => {
    expect(isDestinationActive(data, "/sources")).toBe(true);
    expect(isDestinationActive(data, "/sources/abc")).toBe(true);
    expect(isDestinationActive(data, "/connectors")).toBe(true);
    expect(isDestinationActive(data, "/connectors/complete")).toBe(true);
    expect(isDestinationActive(data, "/connectorsx")).toBe(false);
    expect(isDestinationActive(data, "/pipelines")).toBe(false);
  });

  it("treats Me as current on /settings and /admin/usage only", () => {
    expect(isDestinationActive(me, "/settings")).toBe(true);
    expect(isDestinationActive(me, "/admin/usage")).toBe(true);
    expect(isDestinationActive(me, "/chat")).toBe(false);
    expect(isDestinationActive(me, "/dashboards")).toBe(false);
  });

  it("leaves the rail's Connectors destination current on /connectors only", () => {
    const connectors = navDestinations.find((d) => d.label === "Connectors");
    expect(connectors).toBeDefined();
    if (connectors) {
      expect(isDestinationActive(connectors, "/connectors")).toBe(true);
      expect(isDestinationActive(connectors, "/sources")).toBe(false);
    }
  });
});
