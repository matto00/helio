import { navDestinations } from "./navDestinations";

// Locks the shared source of truth both the desktop sidebar (`App.tsx`) and
// the phone `BottomNav` map over — a change here is a change to both
// surfaces at once, which is the whole point of task 1.2/1.3 (see
// App.test.tsx's "Main navigation" assertions for the desktop side, and
// BottomNav.test.tsx for the phone side; both must agree with this list).
describe("navDestinations", () => {
  it("lists the four top-level sections in sidebar order with matching labels", () => {
    expect(navDestinations.map((d) => d.label)).toEqual([
      "Dashboards",
      "Data Sources",
      "Data Pipelines",
      "Type Registry",
    ]);
  });

  it("lists the matching route paths", () => {
    expect(navDestinations.map((d) => d.to)).toEqual(["/", "/sources", "/pipelines", "/registry"]);
  });

  it("marks only the Dashboards destination as an exact ('end') route match", () => {
    const dashboards = navDestinations.find((d) => d.to === "/");
    expect(dashboards?.end).toBe(true);
    for (const destination of navDestinations.filter((d) => d.to !== "/")) {
      expect(destination.end).not.toBe(true);
    }
  });

  it("gives every destination a distinct Lucide icon component", () => {
    const icons = new Set(navDestinations.map((d) => d.icon));
    expect(icons.size).toBe(navDestinations.length);
  });
});
