import { navDestinations } from "./navDestinations";
import { pickerIdForPathname, sectionForPathname, sectionLabel, sections } from "./sections";

// HEL-724 — the single source of truth every chrome surface (breadcrumb,
// document.title, phone title/sheet, sidebar nav rail, BottomNav) derives
// its route→label/icon/picker mapping from. These tests lock the registry's
// own contract; App.test.tsx/SidebarBody.test.tsx/navDestinations.test.ts/
// BottomNav.test.tsx lock that the consuming surfaces actually read it.
describe("sections registry", () => {
  const expected: Array<{
    path: string;
    label: string;
    pickerId: string;
    showInNav: boolean;
  }> = [
    { path: "/", label: "Dashboards", pickerId: "dashboards", showInNav: true },
    { path: "/sources", label: "Data Sources", pickerId: "sources", showInNav: true },
    { path: "/pipelines", label: "Data Pipelines", pickerId: "pipelines", showInNav: true },
    { path: "/registry", label: "Data Types", pickerId: "registry", showInNav: true },
    { path: "/metrics", label: "Metrics", pickerId: "metrics", showInNav: true },
    { path: "/chat", label: "Assistant", pickerId: "chat", showInNav: true },
    { path: "/settings", label: "Settings", pickerId: "other", showInNav: false },
    { path: "/proposals/review", label: "Review Proposal", pickerId: "other", showInNav: false },
    { path: "/patch-sets/review", label: "Review Changes", pickerId: "other", showInNav: false },
  ];

  it("lists all 9 routes with their expected {label, pickerId, showInNav}", () => {
    expect(
      sections.map((section) => ({
        path: section.path,
        label: section.label,
        pickerId: section.pickerId,
        showInNav: section.showInNav,
      })),
    ).toEqual(expected);
  });

  it.each(expected)(
    "resolves $path to {label: $label, pickerId: $pickerId}",
    ({ path, label, pickerId }) => {
      expect(sectionLabel(path)).toBe(label);
      expect(pickerIdForPathname(path)).toBe(pickerId);
      expect(sectionForPathname(path)?.label).toBe(label);
    },
  );

  it("resolves nested detail routes to their parent section's picker/label", () => {
    expect(pickerIdForPathname("/pipelines/pipe-1")).toBe("pipelines");
    expect(sectionLabel("/pipelines/pipe-1")).toBe("Data Pipelines");
    expect(pickerIdForPathname("/registry/type-1")).toBe("registry");
    expect(pickerIdForPathname("/metrics/metric-1")).toBe("metrics");
  });

  it("nav-visible entries match the current 6 navDestinations, in order", () => {
    const navVisible = sections.filter((section) => section.showInNav);
    expect(navVisible.map((section) => section.path)).toEqual(navDestinations.map((d) => d.to));
    expect(navVisible.map((section) => section.label)).toEqual(navDestinations.map((d) => d.label));
    expect(navVisible).toHaveLength(6);
  });

  // The direct fix for the "review routes had no section" bug (PR #382) —
  // these three used to all silently fall through `breadcrumbLabel`'s
  // default case to "Dashboards".
  it("gives /settings, /proposals/review, and /patch-sets/review each a distinct, non-'Dashboards' label", () => {
    const otherLabels = ["/settings", "/proposals/review", "/patch-sets/review"].map((path) =>
      sectionLabel(path),
    );
    expect(otherLabels).toEqual(["Settings", "Review Proposal", "Review Changes"]);
    expect(new Set(otherLabels).size).toBe(3);
    for (const label of otherLabels) {
      expect(label).not.toBe("Dashboards");
    }
  });

  it("/ matches only the exact root path, not every other route (end: true)", () => {
    expect(pickerIdForPathname("/")).toBe("dashboards");
    for (const path of ["/sources", "/pipelines", "/registry", "/metrics", "/chat", "/settings"]) {
      expect(pickerIdForPathname(path)).not.toBe("dashboards");
    }
  });
});
