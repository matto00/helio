import { act } from "@testing-library/react";

import { makeMarkdownPanel, makeOutputPanel } from "../../../test/panelFixtures";
import { renderWithStore } from "../../../test/renderWithStore";
import { panelsRestored } from "../state/panelsSlice";
import { fetchPanels } from "../state/panelThunks";
import { usePipelineFedFlagSync } from "./usePipelineFedFlagSync";

function Probe() {
  usePipelineFedFlagSync();
  return null;
}

const fed = (dashboardId: string) => [
  makeOutputPanel({ id: `o-${dashboardId}`, dashboardId, config: { outputId: "out1" } }),
];
const md = (dashboardId: string) => [makeMarkdownPanel({ id: `m-${dashboardId}`, dashboardId })];

function setup(flag: boolean | undefined, panels: Record<string, unknown> = {}) {
  const { store } = renderWithStore(
    <Probe />,
    {
      dashboards: {
        items: [{ id: "d1", name: "Ops", hasPipelineFedPanels: flag }],
        selectedDashboardId: "d1",
      },
      panels: { items: [], loadedDashboardId: null, status: "idle", ...panels },
    } as never,
    "/dashboards",
  );
  const flagNow = () => store.getState().dashboards.items[0].hasPipelineFedPanels;
  return { store, flagNow };
}

describe("usePipelineFedFlagSync (HEL-1646)", () => {
  it("writes true once a fetch settles with an output panel", () => {
    const { store, flagNow } = setup(undefined, { loadedDashboardId: "d1", status: "loading" });
    expect(flagNow()).toBeUndefined();
    act(() => {
      store.dispatch(fetchPanels.fulfilled(fed("d1"), "r", "d1"));
    });
    expect(flagNow()).toBe(true);
  });

  it("writes false once a fetch settles markdown-only over a stale true flag", () => {
    const { store, flagNow } = setup(true, { loadedDashboardId: "d1", status: "loading" });
    act(() => {
      store.dispatch(fetchPanels.fulfilled(md("d1"), "r", "d1"));
    });
    expect(flagNow()).toBe(false);
  });

  it("covers the warm-restore path, which bypasses fetchPanels.fulfilled", () => {
    const { store, flagNow } = setup(false);
    act(() => {
      store.dispatch(panelsRestored({ dashboardId: "d1", items: fed("d1") }));
    });
    expect(flagNow()).toBe(true);
  });

  it("follows an in-session add of an output panel", () => {
    const { store, flagNow } = setup(false, {
      items: md("d1"),
      loadedDashboardId: "d1",
      status: "succeeded",
    });
    expect(flagNow()).toBe(false);
    act(() => {
      store.dispatch(panelsRestored({ dashboardId: "d1", items: [...md("d1"), ...fed("d1")] }));
    });
    expect(flagNow()).toBe(true);
  });

  it("never writes false in a non-settled frame: loading with empty items, or another dashboard's items", () => {
    const loading = setup(true, { loadedDashboardId: "d1", status: "loading" });
    expect(loading.flagNow()).toBe(true);
    const stale = setup(true, { items: md("d0"), loadedDashboardId: "d0", status: "succeeded" });
    expect(stale.flagNow()).toBe(true);
  });

  it("writes false when the last panel is deleted (stale-empty state)", () => {
    const { flagNow } = setup(true, { status: "idle", staleDashboardId: "d1" });
    expect(flagNow()).toBe(false);
  });
});
