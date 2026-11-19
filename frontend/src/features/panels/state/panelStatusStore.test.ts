import { act } from "@testing-library/react";

import { fetchDashboardPanelStatus } from "../services/panelStatusService";
import {
  getPanelStatusSnapshot,
  PANEL_STATUS_POLL_MS,
  refreshPanelStatusNow,
  resetPanelStatusStoreForTests,
  subscribePanelDataAdvance,
  subscribePanelStatus,
  type PanelStatusItem,
  type PanelStatusSnapshot,
} from "./panelStatusStore";

jest.mock("../services/panelStatusService");
const fetchMock = jest.mocked(fetchDashboardPanelStatus);

// HEL-1786 D2/D3: a module-scoped, ref-counted poller of `GET /api/dashboards/:id/panel-status`.
function item(over: Partial<PanelStatusItem> = {}): PanelStatusItem {
  return {
    panelId: "p1",
    lastRunAt: "2026-11-10T10:00:00Z",
    runStatus: "succeeded",
    dataUpdatedAt: "2026-11-10T10:00:01Z",
    invalid: false,
    ...over,
  };
}
const snap = (...items: PanelStatusItem[]): PanelStatusSnapshot => ({ items, sources: ["Sales"] });

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
  document.dispatchEvent(new Event("visibilitychange"));
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
async function tick(ms = PANEL_STATUS_POLL_MS) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  setVisibility("visible");
  resetPanelStatusStoreForTests();
  fetchMock.mockReset();
});
afterEach(() => {
  jest.useRealTimers();
});

describe("panel status store", () => {
  it("starts polling with the first subscriber and stops with the last", async () => {
    fetchMock.mockResolvedValue(snap(item()));
    const off1 = subscribePanelStatus("d1", jest.fn());
    const off2 = subscribePanelStatus("d1", jest.fn());
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    off1();
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    off2();
    await tick(PANEL_STATUS_POLL_MS * 3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("keeps one request in flight at a time", async () => {
    let resolve: (s: PanelStatusSnapshot) => void = () => undefined;
    fetchMock.mockReturnValue(new Promise((r) => (resolve = r)));
    subscribePanelStatus("d1", jest.fn());
    await tick(PANEL_STATUS_POLL_MS * 3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolve(snap(item()));
    await flush();
    expect(getPanelStatusSnapshot("d1")).toEqual(snap(item()));
  });

  it("does not poll while hidden and reads immediately when visible again", async () => {
    fetchMock.mockResolvedValue(snap(item()));
    subscribePanelStatus("d1", jest.fn());
    await flush();
    setVisibility("hidden");
    await tick(PANEL_STATUS_POLL_MS * 3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    setVisibility("visible");
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the last good snapshot when a read fails, and retries on the next tick", async () => {
    fetchMock.mockResolvedValueOnce(snap(item()));
    subscribePanelStatus("d1", jest.fn());
    await flush();
    fetchMock.mockRejectedValueOnce(new Error("boom"));
    await tick();
    expect(getPanelStatusSnapshot("d1")).toEqual(snap(item()));
    fetchMock.mockResolvedValueOnce(snap(item({ invalid: true })));
    await tick();
    expect(getPanelStatusSnapshot("d1")?.items[0].invalid).toBe(true);
  });

  it("refreshPanelStatusNow reads immediately", async () => {
    fetchMock.mockResolvedValue(snap(item()));
    subscribePanelStatus("d1", jest.fn());
    await flush();
    refreshPanelStatusNow("d1");
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  describe("the refresh trigger (dataUpdatedAt only)", () => {
    async function watch(first: PanelStatusSnapshot) {
      fetchMock.mockResolvedValueOnce(first);
      const onAdvance = jest.fn();
      subscribePanelDataAdvance("d1", "p1", onAdvance);
      await flush();
      return onAdvance;
    }

    it("never fires on the first (baseline) snapshot", async () => {
      expect(await watch(snap(item()))).not.toHaveBeenCalled();
    });

    it("fires when dataUpdatedAt advances", async () => {
      const onAdvance = await watch(snap(item()));
      fetchMock.mockResolvedValueOnce(snap(item({ dataUpdatedAt: "2026-11-10T10:05:00Z" })));
      await tick();
      expect(onAdvance).toHaveBeenCalledTimes(1);
    });

    it("fires when dataUpdatedAt goes from null to a value", async () => {
      const onAdvance = await watch(snap(item({ dataUpdatedAt: null, lastRunAt: null })));
      fetchMock.mockResolvedValueOnce(snap(item()));
      await tick();
      expect(onAdvance).toHaveBeenCalledTimes(1);
    });

    it("does NOT fire when lastRunAt advances with succeeded and dataUpdatedAt is unchanged (rows not yet committed)", async () => {
      const onAdvance = await watch(snap(item()));
      fetchMock.mockResolvedValueOnce(snap(item({ lastRunAt: "2026-11-10T10:05:00Z" })));
      await tick();
      expect(onAdvance).not.toHaveBeenCalled();
    });

    it("does NOT fire when lastRunAt advances with failed and dataUpdatedAt is unchanged", async () => {
      const onAdvance = await watch(snap(item()));
      fetchMock.mockResolvedValueOnce(
        snap(item({ lastRunAt: "2026-11-10T10:05:00Z", runStatus: "failed" })),
      );
      await tick();
      expect(onAdvance).not.toHaveBeenCalled();
    });

    it("treats a panel that newly appears as its own baseline", async () => {
      const onAdvance = jest.fn();
      fetchMock.mockResolvedValueOnce(snap());
      subscribePanelDataAdvance("d1", "p1", onAdvance);
      await flush();
      fetchMock.mockResolvedValueOnce(snap(item()));
      await tick();
      expect(onAdvance).not.toHaveBeenCalled();
    });

    it("notifies only the panel that advanced", async () => {
      const a = jest.fn();
      const b = jest.fn();
      fetchMock.mockResolvedValueOnce(snap(item(), item({ panelId: "p2" })));
      subscribePanelDataAdvance("d1", "p1", a);
      subscribePanelDataAdvance("d1", "p2", b);
      await flush();
      fetchMock.mockResolvedValueOnce(
        snap(item({ dataUpdatedAt: "2026-11-10T10:05:00Z" }), item({ panelId: "p2" })),
      );
      await tick();
      expect(a).toHaveBeenCalledTimes(1);
      expect(b).not.toHaveBeenCalled();
    });
  });
});
