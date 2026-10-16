import { makeTabsStore } from "../../../../test/tabsTestStore";
import {
  makeOutput,
  outputPanel,
  settledWindow,
  storedEntry,
  storedWindow,
} from "../../../../test/warmFixtures";
import {
  currentGeneration,
  invalidatePipeline,
  isRetained,
  resetOutputFreshness,
} from "../../../panels/state/outputFreshness";
import { getOutputMetaCached } from "../../../panels/state/outputMetaCache";
import { isReusable } from "../../../panels/state/panelRowsReuse";
import { getObservedRunId, hasRunBaseline } from "../../../panels/services/pipelineRunFanout";
import { paginationHydrated } from "../../../panels/state/panelsSlice";
import type { DashboardChange } from "../tabTypes";
import { clearWarmState, getListEntry, getOwnWriteAt, setWarmStoreForTests } from "./warmCache";
import { applyWarmEntry } from "./warmRestore";
import { MemoryWarmStore } from "./warmStore";

jest.mock("../../../panels/services/panelService", () => ({ fetchPanels: jest.fn() }));
jest.mock("../dashboardChangesService", () => ({ fetchDashboardChanges: jest.fn() }));
jest.mock("../../../pipelines/services/outputService", () => ({
  ...jest.requireActual("../../../pipelines/services/outputService"),
  getOutputById: jest.fn(),
  getOutputRows: jest.fn(),
}));

const iso = (ms: number) => new Date(ms).toISOString();
const signal = (over: Partial<DashboardChange> = {}): DashboardChange => ({
  dashboardId: "d1",
  contentUpdatedAt: iso(1_000),
  dataUpdatedAt: null,
  outputs: [],
  ...over,
});

function fixtures() {
  const panels = [outputPanel("p1", "d1", "o1"), outputPanel("p2", "d1", "o2")];
  return storedEntry({
    dashboardId: "d1",
    contentCapturedAt: 5_000,
    panels,
    outputMeta: { o1: makeOutput("o1", "pipe-1"), o2: makeOutput("o2", "pipe-2") },
    runBaseline: { "pipe-1": "run-A" },
    rows: {
      p1: storedWindow("o1", 6_000, 0),
      p2: storedWindow("o2", 6_000, 0),
    },
  });
}

beforeEach(async () => {
  await clearWarmState();
  resetOutputFreshness();
  setWarmStoreForTests(new MemoryWarmStore());
});

describe("applyWarmEntry (HEL-1575 D5 restore on reload)", () => {
  it("seeds the list, output metadata, run baseline and row windows, and takes the retention", () => {
    const { dispatch, getState } = makeTabsStore({});
    const entry = fixtures();
    expect(applyWarmEntry({ dispatch, entry, signal: signal(), tabOwnWriteAt: null })).toBe(true);

    expect(getListEntry("d1")?.panels).toHaveLength(2);
    expect(getListEntry("d1")?.contentCapturedAt).toBe(5_000);
    expect(getOutputMetaCached("o1")?.pipelineId).toBe("pipe-1");
    expect(getObservedRunId("pipe-1")).toBe("run-A");
    expect(hasRunBaseline("pipe-1")).toBe(true);
    expect(Object.keys(getState().panels.paginationState).sort()).toEqual(["p1", "p2"]);
    expect(isRetained("o1")).toBe(true);
  });

  it("a restored window is reusable, and a run after the capture bumps the generation after restore", () => {
    const { dispatch, getState } = makeTabsStore({});
    applyWarmEntry({ dispatch, entry: fixtures(), signal: signal(), tabOwnWriteAt: null });
    const window = getState().panels.paginationState.p1;
    const query = { outputId: "o1", crossFilterEq: null };
    // Restamped with the generation read AFTER the metadata (and its pipeline) was seeded.
    expect(window.generation).toBe(currentGeneration("o1"));
    expect(isReusable(window, query)).toBe(true);
    // A pipeline run observed after the restore invalidates the window.
    invalidatePipeline("pipe-1");
    expect(isReusable(window, query)).toBe(false);
  });

  it("restamps the generation with the page's own counters, not the stored ones", () => {
    const { dispatch, getState } = makeTabsStore({});
    const entry = fixtures();
    entry.rows.p1 = storedWindow("o1", 6_000, 41); // 41 was meaningless: counters restart on load
    applyWarmEntry({ dispatch, entry, signal: signal(), tabOwnWriteAt: null });
    expect(getState().panels.paginationState.p1.generation).toBe(currentGeneration("o1"));
    expect(getState().panels.paginationState.p1.generation).not.toBe(41);
  });

  it("drops a copy whose content changed since it was captured and seeds nothing", () => {
    const { dispatch, getState } = makeTabsStore({});
    const applied = applyWarmEntry({
      dispatch,
      entry: fixtures(),
      signal: signal({ contentUpdatedAt: iso(9_000) }),
      tabOwnWriteAt: null,
    });
    expect(applied).toBe(false);
    expect(getListEntry("d1")).toBeUndefined();
    expect(getOutputMetaCached("o1")).toBeUndefined();
    expect(getState().panels.paginationState).toEqual({});
  });

  it("cannot validate without a signal: loads cold", () => {
    const { dispatch } = makeTabsStore({});
    expect(
      applyWarmEntry({ dispatch, entry: fixtures(), signal: undefined, tabOwnWriteAt: null }),
    ).toBe(false);
  });

  it("takes the LATER of the stored and the server ownWriteAt (design review note 4)", () => {
    // content at 8000 post-dates the capture (5000), so only an own write at or after 8000 validates it.
    const stale = signal({ contentUpdatedAt: iso(8_000) });
    const a = makeTabsStore({});
    expect(
      applyWarmEntry({
        dispatch: a.dispatch,
        entry: { ...fixtures(), ownWriteAt: 1_000 },
        signal: stale,
        tabOwnWriteAt: 9_000, // the keepalive pref flush landed; the debounced browser patch did not
      }),
    ).toBe(true);
    expect(getOwnWriteAt("d1")).toBe(9_000);
    const b = makeTabsStore({});
    expect(
      applyWarmEntry({
        dispatch: b.dispatch,
        entry: { ...fixtures(), ownWriteAt: 9_000 },
        signal: stale,
        tabOwnWriteAt: 1_000,
      }),
    ).toBe(true);
    const c = makeTabsStore({});
    expect(
      applyWarmEntry({
        dispatch: c.dispatch,
        entry: { ...fixtures(), ownWriteAt: 1_000 },
        signal: stale,
        tabOwnWriteAt: 2_000,
      }),
    ).toBe(false);
  });

  it("hydrates only windows whose Output has no newer data than the window's capture", () => {
    const { dispatch, getState } = makeTabsStore({});
    const entry = fixtures();
    applyWarmEntry({
      dispatch,
      entry,
      signal: signal({
        outputs: [
          { outputId: "o1", dataUpdatedAt: iso(7_000) }, // newer than p1's capture at 6000: stale
          { outputId: "o2", dataUpdatedAt: iso(5_500) }, // older than p2's capture: fresh
        ],
      }),
      tabOwnWriteAt: null,
    });
    expect(Object.keys(getState().panels.paginationState)).toEqual(["p2"]);
  });

  it("never clobbers an existing window (settled or in flight): paginationHydrated skips it", () => {
    const { dispatch, getState } = makeTabsStore({});
    const live = { ...settledWindow("o1", 9_999, 3), rows: [{ live: true }] };
    dispatch(paginationHydrated({ p1: live }));
    applyWarmEntry({ dispatch, entry: fixtures(), signal: signal(), tabOwnWriteAt: null });
    expect(getState().panels.paginationState.p1.rows).toEqual([{ live: true }]);
    expect(getState().panels.paginationState.p2.rows).toEqual([{ a: 1 }]);
  });

  it("never touches latestFetchRequestId", () => {
    const { dispatch, getState } = makeTabsStore({});
    applyWarmEntry({ dispatch, entry: fixtures(), signal: signal(), tabOwnWriteAt: null });
    expect(getState().panels.latestFetchRequestId).toEqual({});
  });
});
