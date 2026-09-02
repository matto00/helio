import { navDestinations } from "./navDestinations";
import { pickerIdForPathname, sectionForPathname, sectionLabel, sections } from "./sections";

// HEL-724 — the single source of truth every chrome surface (breadcrumb,
// document.title, phone title/sheet, sidebar nav rail, BottomNav) derives
// its route→label/icon/picker mapping from. These tests lock the registry's
// own contract; App.test.tsx/SidebarBody.test.tsx/navDestinations.test.ts/
// BottomNav.test.tsx lock that the consuming surfaces actually read it.
//
// HEL-909: Data Types (/registry) and Metrics (/metrics) are retired
// outright — nav collapses from 7 destinations to 5.
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
    { path: "/connectors", label: "Connectors", pickerId: "other", showInNav: true },
    { path: "/chat", label: "Assistant", pickerId: "chat", showInNav: true },
    { path: "/settings", label: "Settings", pickerId: "other", showInNav: false },
    { path: "/proposals/review", label: "Review Proposal", pickerId: "other", showInNav: false },
    { path: "/patch-sets/review", label: "Review Changes", pickerId: "other", showInNav: false },
    {
      path: "/pipeline-proposals/review",
      label: "Review Pipeline Proposal",
      pickerId: "other",
      showInNav: false,
    },
    {
      path: "/combined-proposals/review",
      label: "Review Combined Proposal",
      pickerId: "other",
      showInNav: false,
    },
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
  });

  it("nav-visible entries match the current 5 navDestinations, in order", () => {
    const navVisible = sections.filter((section) => section.showInNav);
    expect(navVisible.map((section) => section.path)).toEqual(navDestinations.map((d) => d.to));
    expect(navVisible.map((section) => section.label)).toEqual(navDestinations.map((d) => d.label));
    expect(navVisible).toHaveLength(5);
  });

  // The direct fix for the "review routes had no section" bug (PR #382) — these three used to all
  // silently fall through `breadcrumbLabel`'s default case to "Dashboards". HEL-739 reintroduced
  // the identical bug for its two new review routes (final-gate skeptic REFUTE, round 1); extended
  // here to guard all five "other"-picker routes, not just the original three.
  const OTHER_PICKER_PATHS = [
    "/settings",
    "/proposals/review",
    "/patch-sets/review",
    "/pipeline-proposals/review",
    "/combined-proposals/review",
  ];

  it("gives each 'other'-picker route a distinct, non-'Dashboards' label", () => {
    const otherLabels = OTHER_PICKER_PATHS.map((path) => sectionLabel(path));
    expect(otherLabels).toEqual([
      "Settings",
      "Review Proposal",
      "Review Changes",
      "Review Pipeline Proposal",
      "Review Combined Proposal",
    ]);
    expect(new Set(otherLabels).size).toBe(OTHER_PICKER_PATHS.length);
    for (const label of otherLabels) {
      expect(label).not.toBe("Dashboards");
    }
  });

  it("/ matches only the exact root path, not every other route (end: true)", () => {
    expect(pickerIdForPathname("/")).toBe("dashboards");
    for (const path of ["/sources", "/pipelines", "/chat", "/settings"]) {
      expect(pickerIdForPathname(path)).not.toBe("dashboards");
    }
  });

  // HEL-909: the retired routes must not resolve to a stale section — they
  // fall through to the "other"/"Dashboards" catch-all, just like any other
  // unregistered path (no stub, no redirect — decision 11).
  it("no longer resolves /registry or /metrics to a real section", () => {
    expect(sections.some((section) => section.path === "/registry")).toBe(false);
    expect(sections.some((section) => section.path === "/metrics")).toBe(false);
    expect(pickerIdForPathname("/registry")).toBe("other");
    expect(pickerIdForPathname("/metrics")).toBe("other");
  });
});
