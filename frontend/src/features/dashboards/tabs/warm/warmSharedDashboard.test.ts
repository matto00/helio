// HEL-1783: a dashboard the caller does not own stays in the warm tab cache (panel list + row windows only: no Output metadata,
// no run baselines), is restored only while the caller's current role matches the copy's read scope, and is re-read only through
// the per-panel routes (never /api/outputs/* or /api/pipelines/*).
import { fetchPanels as fetchPanelsRequest } from "../../../panels/services/panelService";
import { dash, makeTabsStore, tab } from "../../../../test/tabsTestStore";
import {
  makeOutput,
  outputPanel,
  settledWindow,
  storedEntry,
  storedWindow,
} from "../../../../test/warmFixtures";
import { resetOutputFreshness } from "../../../panels/state/outputFreshness";
import { getOutputMetaCached, getOutputPanelScope } from "../../../panels/state/outputMetaCache";
import { hasRunBaseline, resetRunBaselines } from "../../../panels/services/pipelineRunFanout";
import { hasRestoreMarker, clearRestoreMarkers } from "../../../panels/state/restoreMarkers";
import { paginationHydrated } from "../../../panels/state/panelsSlice";
import { seedPanelStatusBaseline } from "../../../panels/state/panelStatusStore";
import { getOutputById } from "../../../pipelines/services/outputService";
import { hydrateTabs } from "../hydrateTabs";
import { fetchDashboardChanges } from "../dashboardChangesService";
import type { DashboardChange } from "../tabTypes";
import {
  clearWarmState,
  getListEntry,
  getWarmStore,
  setListEntry,
  setWarmStoreForTests,
} from "./warmCache";
import { captureTab } from "./warmCapture";
import { showDashboardPanels } from "./showDashboardPanels";
import { applyWarmEntry } from "./warmRestore";
import { MemoryWarmStore, sanitizeEntry } from "./warmStore";
import { seedObservedRun } from "../../../panels/services/pipelineRunFanout";
import { seedOutputMeta, unscopeOutput } from "../../../panels/state/outputMetaCache";

jest.mock("../../../panels/services/panelService", () => ({ fetchPanels: jest.fn() }));
jest.mock("../dashboardChangesService", () => ({ fetchDashboardChanges: jest.fn() }));
jest.mock("../../../auth/services/authService", () => ({
  patchDashboardTabsRequest: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../../pipelines/services/outputService", () => ({
  ...jest.requireActual("../../../pipelines/services/outputService"),
  getOutputById: jest.fn(),
  getOutputRows: jest.fn(),
}));
jest.mock("../../../panels/state/panelStatusStore", () => ({
  ...jest.requireActual("../../../panels/state/panelStatusStore"),
  seedPanelStatusBaseline: jest.fn(),
}));

const fetchPanelsMock = jest.mocked(fetchPanelsRequest);
const outputById = jest.mocked(getOutputById);
const seedMock = jest.mocked(seedPanelStatusBaseline);
const changesMock = jest.mocked(fetchDashboardChanges);
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const panelsA = [outputPanel("pa1", "a", "o1")];
const panelsB = [outputPanel("pb1", "b", "o9")];
const CAPTURED = Date.now() - 20 * 60_000;

function signal(id: string, over: Partial<DashboardChange> = {}): DashboardChange {
  return {
    dashboardId: id,
    contentUpdatedAt: ago(60 * 60_000),
    dataUpdatedAt: null,
    outputs: [],
    ...over,
  };
}

type Role = "owner" | "viewer" | "editor";
function scene(role: Role | "unknown", signalOver: Partial<DashboardChange> = {}) {
  const dashboards = [
    dash("b"),
    ...(role === "unknown" ? [] : [{ ...dash("a"), accessRole: role }]),
  ];
  return makeTabsStore({
    dashboards,
    tabs: [tab("a", ago(60_000)), tab("b", ago(1_000))],
    activeId: "a",
    selected: "a",
    panels: { items: panelsB, loadedDashboardId: "b" },
    changeSignals: { a: signal("a", signalOver) },
  });
}

const storedPanelEntry = (over = {}) =>
  storedEntry({
    dashboardId: "a",
    contentCapturedAt: CAPTURED,
    lastViewedAt: Date.now() - 30_000,
    panels: panelsA,
    rows: { pa1: storedWindow("o1", CAPTURED + 1_000, 0) },
    readScope: "panel",
    ...over,
  });

beforeEach(async () => {
  await clearWarmState();
  resetOutputFreshness();
  resetRunBaselines();
  clearRestoreMarkers();
  unscopeOutput("o1");
  setWarmStoreForTests(new MemoryWarmStore());
  fetchPanelsMock.mockReset();
  fetchPanelsMock.mockImplementation(async (id) => (id === "a" ? panelsA : panelsB));
  outputById.mockReset();
  seedMock.mockReset();
  changesMock.mockReset();
});

describe("capture of a dashboard the caller does not own", () => {
  it.each([
    ["viewer", "panel"],
    ["editor", "panel"],
    ["owner", "output"],
  ] as const)(
    "a %s dashboard's loaded panels and rows are captured with readScope %s, through BoundedWarmStore.write",
    async (role, readScope) => {
      const { getState, dispatch } = makeTabsStore({
        dashboards: [{ ...dash("a"), accessRole: role }],
        tabs: [tab("a", ago(1_000))],
        activeId: "a",
        selected: "a",
        panels: { items: panelsA, loadedDashboardId: "a" },
      });
      dispatch(paginationHydrated({ pa1: settledWindow("o1", CAPTURED) }));
      // An Output cached through the owner route elsewhere, and a run observed: neither may leak into a shared copy.
      seedOutputMeta("o1", makeOutput("o1", "pipe-1"));
      seedObservedRun("pipe-1", "run-1");
      setListEntry("a", { panels: [], contentCapturedAt: 1 });
      captureTab(getState, "a", { retain: false, immediate: true });
      await new Promise((r) => setTimeout(r, 0));
      expect(getListEntry("a")?.panels).toEqual(panelsA);
      expect(getListEntry("a")?.readScope).toBe(readScope);
      const stored = await getWarmStore().read("user-1", "a");
      expect(stored?.readScope).toBe(readScope);
      expect(Object.keys(stored?.rows ?? {})).toEqual(["pa1"]);
      if (readScope === "panel") {
        expect(stored?.outputMeta).toEqual({});
        expect(stored?.runBaseline).toEqual({});
      } else {
        expect(Object.keys(stored?.outputMeta ?? {})).toEqual(["o1"]);
        expect(stored?.runBaseline).toEqual({ "pipe-1": "run-1" });
      }
    },
  );

  it("sanitizeEntry keeps readScope (an entry stored before it existed reads back without one)", () => {
    expect(sanitizeEntry(storedPanelEntry()).readScope).toBe("panel");
    expect(sanitizeEntry(storedEntry({ dashboardId: "a" })).readScope).toBeUndefined();
  });
});

describe("restore of a shared dashboard from memory", () => {
  function inMemory(readScope: "panel" | "output" | undefined) {
    setListEntry("a", { panels: panelsA, contentCapturedAt: CAPTURED, readScope });
  }

  it("restores with no panel-list request, per-panel Output scope, no Output service call, a marker and a status seed", async () => {
    const { dispatch } = scene("viewer");
    inMemory("panel");
    dispatch(paginationHydrated({ pa1: settledWindow("o1", CAPTURED + 1_000) }));
    await dispatch(showDashboardPanels("a"));
    expect(fetchPanelsMock).not.toHaveBeenCalled();
    expect(outputById).not.toHaveBeenCalled();
    expect(getOutputPanelScope("o1")).toEqual({ dashboardId: "a", panelId: "pa1" });
    expect(hasRestoreMarker("pa1")).toBe(true);
    expect(seedMock).toHaveBeenCalledWith("a", { pa1: CAPTURED + 1_000 });
  });

  it.each([
    ["an owner-scoped list read by a viewer", "viewer", "output"],
    ["a list with no scope (stored before this change) read by a viewer", "viewer", undefined],
    ["a panel-scoped list read by the owner", "owner", "panel"],
    ["a list for a dashboard the store does not hold", "unknown", "panel"],
  ] as const)("%s loads cold", async (_name, role, readScope) => {
    const { dispatch } = scene(role);
    inMemory(readScope);
    await dispatch(showDashboardPanels("a"));
    expect(fetchPanelsMock).toHaveBeenCalledWith("a");
    expect(seedMock).not.toHaveBeenCalled();
    expect(hasRestoreMarker("pa1")).toBe(false);
  });

  it("a window whose Output received newer data is invalidated, not seeded and not marked", async () => {
    const { dispatch, getState } = scene("viewer", {
      outputs: [{ outputId: "o1", dataUpdatedAt: new Date(CAPTURED + 5_000).toISOString() }],
    });
    inMemory("panel");
    dispatch(paginationHydrated({ pa1: settledWindow("o1", CAPTURED + 1_000) }));
    await dispatch(showDashboardPanels("a"));
    expect(fetchPanelsMock).not.toHaveBeenCalled();
    expect(seedMock).not.toHaveBeenCalledWith(
      "a",
      expect.objectContaining({ pa1: expect.anything() }),
    );
    expect(hasRestoreMarker("pa1")).toBe(false);
    const { currentGeneration } = jest.requireActual("../../../panels/state/outputFreshness");
    expect(getState().panels.paginationState.pa1.generation).not.toBe(currentGeneration("o1"));
  });
});

describe("restore of a shared dashboard from the browser copy", () => {
  async function storeThroughBound(entry = storedPanelEntry()) {
    await getWarmStore().write(entry);
    expect(await getWarmStore().read("user-1", "a")).toBeDefined();
  }

  it("restores through BoundedWarmStore with no request, and never seeds Output metadata or a run baseline", async () => {
    const { dispatch, getState } = scene("viewer");
    // Hostile copy: a panel-scoped entry that nevertheless carries owner data must not seed it.
    await storeThroughBound(
      storedPanelEntry({
        outputMeta: { o1: makeOutput("o1", "pipe-1") },
        runBaseline: { "pipe-1": "run-A" },
      }),
    );
    await dispatch(showDashboardPanels("a"));
    expect(fetchPanelsMock).not.toHaveBeenCalled();
    expect(outputById).not.toHaveBeenCalled();
    expect(getState().panels.loadedDashboardId).toBe("a");
    expect(getOutputPanelScope("o1")).toEqual({ dashboardId: "a", panelId: "pa1" });
    expect(getOutputMetaCached("o1")).toBeUndefined();
    expect(hasRunBaseline("pipe-1")).toBe(false);
    expect(getState().panels.paginationState.pa1.capturedAt).toBe(CAPTURED + 1_000);
    expect(seedMock).toHaveBeenCalledWith("a", { pa1: CAPTURED + 1_000 });
    expect(hasRestoreMarker("pa1")).toBe(true);
  });

  it.each([
    ["an owner-scoped copy (no readScope) read by a viewer", "viewer", undefined],
    ["an explicit owner-scoped copy read by an editor", "editor", "output"],
    ["a panel-scoped copy read by the owner", "owner", "panel"],
    ["a copy for a dashboard the store does not hold", "unknown", "panel"],
  ] as const)(
    "%s: showDashboardPanels drops it, seeds nothing and loads cold",
    async (_name, role, readScope) => {
      const { dispatch } = scene(role);
      await storeThroughBound(
        storedPanelEntry({
          readScope,
          outputMeta: { o1: makeOutput("o1", "pipe-1") },
          runBaseline: { "pipe-1": "run-A" },
        }),
      );
      await dispatch(showDashboardPanels("a"));
      expect(fetchPanelsMock).toHaveBeenCalledWith("a");
      expect(getOutputMetaCached("o1")).toBeUndefined();
      expect(hasRunBaseline("pipe-1")).toBe(false);
      expect(seedMock).not.toHaveBeenCalled();
      await new Promise((r) => setTimeout(r, 0));
      expect(await getWarmStore().read("user-1", "a")).toBeUndefined();
    },
  );

  it("applyWarmEntry itself refuses a scope mismatch or an unknown scope before seeding anything", () => {
    const { dispatch, getState } = scene("viewer");
    for (const scope of ["output", null] as const) {
      const entry = storedPanelEntry({
        outputMeta: { o1: makeOutput("o1", "pipe-1") },
        runBaseline: { "pipe-1": "run-A" },
      });
      expect(
        applyWarmEntry({ dispatch, entry, signal: signal("a"), tabOwnWriteAt: null, scope }),
      ).toBe(false);
      expect(getListEntry("a")).toBeUndefined();
      expect(getOutputMetaCached("o1")).toBeUndefined();
      expect(hasRunBaseline("pipe-1")).toBe(false);
      expect(getState().panels.paginationState).toEqual({});
    }
  });
});

describe("hydrateTabs (the other stored-copy caller)", () => {
  async function hydrate(role: Role, entry: ReturnType<typeof storedPanelEntry>) {
    const { testUser } = jest.requireActual("../../../../test/tabsTestStore");
    changesMock.mockResolvedValue({
      serverNow: new Date().toISOString(),
      items: [signal("a")],
    });
    const harness = makeTabsStore({
      dashboards: [{ ...dash("a"), accessRole: role }],
      selected: "a",
      hydrated: false,
      user: testUser({ tabs: [{ id: "a", lastViewedAt: ago(30_000) }], activeId: "a" }),
    });
    await getWarmStore().write(entry);
    await harness.dispatch(hydrateTabs());
    return harness;
  }

  it("a viewer's panel-scoped copy is restored, with no Output metadata and no run baseline", async () => {
    await hydrate("viewer", storedPanelEntry());
    // The per-panel scope itself is applied when the panels are shown (`showDashboardPanels`' memory restore), not here.
    expect(getListEntry("a")?.readScope).toBe("panel");
    expect(getOutputMetaCached("o1")).toBeUndefined();
    expect(hasRunBaseline("pipe-1")).toBe(false);
  });

  it("an owner-scoped copy read while the caller is a viewer seeds no Output metadata and no run baseline, and is deleted", async () => {
    await hydrate(
      "viewer",
      storedPanelEntry({
        readScope: undefined,
        outputMeta: { o1: makeOutput("o1", "pipe-1") },
        runBaseline: { "pipe-1": "run-A" },
      }),
    );
    expect(getListEntry("a")).toBeUndefined();
    expect(getOutputMetaCached("o1")).toBeUndefined();
    expect(hasRunBaseline("pipe-1")).toBe(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(await getWarmStore().read("user-1", "a")).toBeUndefined();
  });
});
