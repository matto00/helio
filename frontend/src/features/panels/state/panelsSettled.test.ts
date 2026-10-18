import { makeMarkdownPanel } from "../../../test/panelFixtures";
import { panelsKnownFor, panelsSettledFor } from "./panelsSettled";

const md = (dashboardId: string) => [makeMarkdownPanel({ id: `m-${dashboardId}`, dashboardId })];
const base = {
  items: [],
  loadedDashboardId: null,
  status: "idle" as const,
  staleDashboardId: null,
};

describe("panelsSettledFor / panelsKnownFor (HEL-1646)", () => {
  it("is false with no selected dashboard", () => {
    expect(panelsSettledFor({ ...base, items: md("d1") }, null)).toBe(false);
    expect(panelsKnownFor({ ...base, items: md("d1") }, null)).toBe(false);
  });

  it("is false while loading with empty items (cold open skeleton)", () => {
    const state = { ...base, loadedDashboardId: "d1", status: "loading" as const };
    expect(panelsSettledFor(state, "d1")).toBe(false);
    expect(panelsKnownFor(state, "d1")).toBe(false);
  });

  it("is false for another dashboard's stale items, loading or in the pre-dispatch switch frame", () => {
    const loading = {
      ...base,
      items: md("d0"),
      loadedDashboardId: "d1",
      status: "loading" as const,
    };
    const preDispatch = {
      ...base,
      items: md("d0"),
      loadedDashboardId: "d0",
      status: "succeeded" as const,
    };
    for (const state of [loading, preDispatch]) {
      expect(panelsSettledFor(state, "d1")).toBe(false);
      expect(panelsKnownFor(state, "d1")).toBe(false);
    }
  });

  it("is false while a warm restore shows the previous dashboard's items", () => {
    const state = {
      ...base,
      items: md("d0"),
      loadedDashboardId: null,
      status: "succeeded" as const,
    };
    expect(panelsKnownFor(state, "d1")).toBe(false);
  });

  it("is true when the items belong to the dashboard", () => {
    const state = {
      ...base,
      items: md("d1"),
      loadedDashboardId: "d1",
      status: "succeeded" as const,
    };
    expect(panelsSettledFor(state, "d1")).toBe(true);
    expect(panelsKnownFor(state, "d1")).toBe(true);
  });

  it("is true for a settled-empty dashboard", () => {
    const state = { ...base, loadedDashboardId: "d1", status: "succeeded" as const };
    expect(panelsSettledFor(state, "d1")).toBe(true);
    expect(panelsKnownFor(state, "d1")).toBe(true);
  });

  it("treats the delete-last stale-empty state as known but not settled", () => {
    const state = { ...base, staleDashboardId: "d1" };
    expect(panelsSettledFor(state, "d1")).toBe(false);
    expect(panelsKnownFor(state, "d1")).toBe(true);
    expect(panelsKnownFor(state, "d2")).toBe(false);
  });

  it("is false after a failed fetch", () => {
    const state = { ...base, loadedDashboardId: "d1", status: "failed" as const };
    expect(panelsKnownFor(state, "d1")).toBe(false);
  });
});
