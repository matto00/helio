import { makeOutputPanel, makeTextPanel } from "../../../test/panelFixtures";
import { deriveDashboardMetaFromStatus, MAX_SHOWN_SOURCES } from "./dashboardMeta";
import type { PanelStatusItem, PanelStatusSnapshot } from "./panelStatusStore";

// HEL-1786 D2: the grantee's meta row facts derived from the dashboard panel-status route, in the owner row's own shape.
const panels = [
  makeOutputPanel({ id: "p1", config: { outputId: "o1" } }),
  makeOutputPanel({ id: "p2", config: { outputId: "o2" } }),
  makeTextPanel({ id: "t1" }),
];

function item(over: Partial<PanelStatusItem> & { panelId: string }): PanelStatusItem {
  return { lastRunAt: null, runStatus: null, dataUpdatedAt: null, invalid: false, ...over };
}
const snapshot = (items: PanelStatusItem[], sources: string[] = []): PanelStatusSnapshot => ({
  items,
  sources,
});

describe("deriveDashboardMetaFromStatus", () => {
  it("is unknown while the status is not loaded, keeping the panel count", () => {
    const meta = deriveDashboardMetaFromStatus(panels, null);
    expect(meta).toMatchObject({ panelCount: 3, refreshState: "unknown", refreshedAt: null });
  });

  it("is unknown when the status lists no Output panel", () => {
    expect(deriveDashboardMetaFromStatus(panels, snapshot([])).refreshState).toBe("unknown");
  });

  it("is never when items exist and none has run", () => {
    const meta = deriveDashboardMetaFromStatus(panels, snapshot([item({ panelId: "p1" })]));
    expect(meta).toMatchObject({ refreshState: "never", refreshedAt: null, refreshIntent: null });
  });

  it("is ran with the LATEST lastRunAt and that item's intent (success)", () => {
    const meta = deriveDashboardMetaFromStatus(
      panels,
      snapshot([
        item({ panelId: "p1", lastRunAt: "2026-11-10T10:00:00Z", runStatus: "failed" }),
        item({ panelId: "p2", lastRunAt: "2026-11-10T11:00:00Z", runStatus: "succeeded" }),
      ]),
    );
    expect(meta).toMatchObject({
      refreshState: "ran",
      refreshedAt: "2026-11-10T11:00:00Z",
      refreshIntent: "success",
    });
  });

  it("maps a failed latest run to the danger intent, a null status to no intent", () => {
    const failed = deriveDashboardMetaFromStatus(
      panels,
      snapshot([item({ panelId: "p1", lastRunAt: "2026-11-10T10:00:00Z", runStatus: "failed" })]),
    );
    expect(failed.refreshIntent).toBe("danger");
    const none = deriveDashboardMetaFromStatus(
      panels,
      snapshot([item({ panelId: "p1", lastRunAt: "2026-11-10T10:00:00Z", runStatus: null })]),
    );
    expect(none).toMatchObject({ refreshState: "ran", refreshIntent: null });
  });

  it("caps the sources and counts the rest", () => {
    const names = ["A", "B", "C", "D"];
    const meta = deriveDashboardMetaFromStatus(panels, snapshot([item({ panelId: "p1" })], names));
    expect(meta.sources).toEqual(names.slice(0, MAX_SHOWN_SOURCES));
    expect(meta.moreSources).toBe(names.length - MAX_SHOWN_SOURCES);
  });
});
