import { act } from "@testing-library/react";

import { fetchDashboardPanelStatus } from "../services/panelStatusService";
import {
  PANEL_STATUS_POLL_MS,
  resetPanelStatusStoreForTests,
  seedPanelStatusBaseline,
  subscribePanelDataAdvance,
  subscribePanelStatus,
  type PanelStatusItem,
  type PanelStatusSnapshot,
} from "./panelStatusStore";
import { resetOutputFreshness } from "./outputFreshness";

jest.mock("../services/panelStatusService");
const fetchMock = jest.mocked(fetchDashboardPanelStatus);

// HEL-1783 D4: a panel restored from the warm tab cache baselines its run-finish refresh on its RESTORED rows' capture time,
// so a run after the last change-signal refresh but before the return is not swallowed as "the first read is a baseline".
const T = (s: number) => Date.UTC(2026, 10, 10, 10, 0, s);
const iso = (s: number) => new Date(T(s)).toISOString();
function item(panelId: string, dataSec: number | null): PanelStatusItem {
  return {
    panelId,
    lastRunAt: iso(0),
    runStatus: "succeeded",
    dataUpdatedAt: dataSec === null ? null : iso(dataSec),
    invalid: false,
  };
}
const snap = (...items: PanelStatusItem[]): PanelStatusSnapshot => ({ items, sources: [] });

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
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  resetPanelStatusStoreForTests();
  resetOutputFreshness();
  fetchMock.mockReset();
});
afterEach(() => jest.useRealTimers());

describe("seedPanelStatusBaseline (HEL-1783 D4)", () => {
  it("(a) fires on the first snapshot iff the item's data is strictly later than the seed", async () => {
    fetchMock.mockResolvedValue(
      snap(item("later", 20), item("equal", 10), item("earlier", 5), item("nulled", null)),
    );
    const fired: string[] = [];
    seedPanelStatusBaseline("d1", { later: T(10), equal: T(10), earlier: T(10), nulled: T(10) });
    for (const id of ["later", "equal", "earlier", "nulled"]) {
      subscribePanelDataAdvance("d1", id, () => fired.push(id));
    }
    await flush();
    expect(fired).toEqual(["later"]);
  });

  it("(a) an unseeded panel still baselines on the first snapshot and diffs afterwards", async () => {
    fetchMock.mockResolvedValueOnce(snap(item("p1", 10))).mockResolvedValue(snap(item("p1", 20)));
    const fired = jest.fn();
    subscribePanelDataAdvance("d1", "p1", fired);
    await flush();
    expect(fired).not.toHaveBeenCalled();
    await tick();
    expect(fired).toHaveBeenCalledTimes(1);
  });

  it("(a) a seed applies to a read issued BEFORE the seed and resolving after it", async () => {
    let resolve: (s: PanelStatusSnapshot) => void = () => undefined;
    fetchMock.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const fired = jest.fn();
    subscribePanelDataAdvance("d1", "p1", fired);
    seedPanelStatusBaseline("d1", { p1: T(10) });
    resolve(snap(item("p1", 20)));
    await flush();
    expect(fired).toHaveBeenCalledTimes(1);
  });

  it("(a) a seed applies to a read issued AFTER the seed", async () => {
    seedPanelStatusBaseline("d1", { p1: T(10) });
    fetchMock.mockResolvedValue(snap(item("p1", 20)));
    const fired = jest.fn();
    subscribePanelDataAdvance("d1", "p1", fired);
    await flush();
    expect(fired).toHaveBeenCalledTimes(1);
  });

  it("(a) a seed is consumed by the first snapshot that resolves: a later snapshot diffs against the previous one", async () => {
    fetchMock.mockResolvedValue(snap(item("p1", 20)));
    const fired = jest.fn();
    seedPanelStatusBaseline("d1", { p1: T(10) });
    subscribePanelDataAdvance("d1", "p1", fired);
    await flush();
    expect(fired).toHaveBeenCalledTimes(1);
    await tick();
    expect(fired).toHaveBeenCalledTimes(1);
  });

  it("(b) an advance resolving before the panel's listener subscribes is kept pending and delivered on subscribe, once", async () => {
    fetchMock.mockResolvedValue(snap(item("p1", 20), item("p2", 20)));
    seedPanelStatusBaseline("d1", { p1: T(10), p2: T(10) });
    subscribePanelStatus("d1", jest.fn()); // the meta row: a consumer, but no advance listener for p1 yet
    await flush();
    const late = jest.fn();
    const off = subscribePanelDataAdvance("d1", "p1", late);
    expect(late).toHaveBeenCalledTimes(1);
    off();
    const again = jest.fn();
    subscribePanelDataAdvance("d1", "p1", again);
    expect(again).not.toHaveBeenCalled();
  });

  it("(c) the seed lives independent of the ref-counted entry: no consumer at seed time, one later", async () => {
    seedPanelStatusBaseline("d1", { p1: T(10) });
    await tick(PANEL_STATUS_POLL_MS * 2);
    fetchMock.mockResolvedValue(snap(item("p1", 20)));
    const fired = jest.fn();
    subscribePanelDataAdvance("d1", "p1", fired);
    await flush();
    expect(fired).toHaveBeenCalledTimes(1);
  });

  it("(c) a later seed for the same dashboard replaces the earlier one", async () => {
    seedPanelStatusBaseline("d1", { p1: T(10) });
    seedPanelStatusBaseline("d1", { p1: T(30) });
    fetchMock.mockResolvedValue(snap(item("p1", 20)));
    const fired = jest.fn();
    subscribePanelDataAdvance("d1", "p1", fired);
    await flush();
    expect(fired).not.toHaveBeenCalled();
  });

  it("(c) a freshness reset clears seeds and pending advances", async () => {
    fetchMock.mockResolvedValue(snap(item("p1", 20)));
    seedPanelStatusBaseline("d1", { p1: T(10) });
    subscribePanelStatus("d1", jest.fn());
    await flush();
    resetOutputFreshness(); // logout: pending advance for p1 is dropped with the entry and the seed
    const late = jest.fn();
    subscribePanelDataAdvance("d1", "p1", late);
    expect(late).not.toHaveBeenCalled();
    seedPanelStatusBaseline("d2", { p1: T(10) });
    resetOutputFreshness();
    fetchMock.mockResolvedValue(snap(item("p1", 20)));
    const fired = jest.fn();
    subscribePanelDataAdvance("d2", "p1", fired);
    await flush();
    expect(fired).not.toHaveBeenCalled();
  });
});
