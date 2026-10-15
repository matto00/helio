import { readFileSync } from "fs";
import { join } from "path";

import {
  createPanel,
  deletePanel,
  duplicatePanel,
  markDashboardPanelsStale,
  updatePanelAppearance,
  updatePanelDivider,
  updatePanelForm,
  updatePanelImage,
  updatePanelMarkdownContent,
  updatePanelOutputControls,
  updatePanelsBatch,
  updatePanelTextContent,
  updatePanelTitle,
} from "../../../panels/state/panelsSlice";
import { swapPanelOutput } from "../../../panels/state/panelThunks";
import { applyPatchSet, undoPatchSet } from "../../../patchSets/state/patchSetsSlice";
import {
  applyProposal,
  duplicateDashboard,
  importDashboard,
  renameDashboard,
  updateDashboardAppearance,
  updateDashboardLayout,
} from "../../state/dashboardsSlice";
import { dash, makeTabsStore, tab } from "../../../../test/tabsTestStore";
import { outputPanel, storedEntry } from "../../../../test/warmFixtures";
import { selectTabHasChanged } from "../dashboardTabsSelectors";
import { activateTab, changeSignalsReceived } from "../dashboardTabsSlice";
import { clearAuth } from "../../../auth/state/authSlice";
import { resetOutputFreshness } from "../../../panels/state/outputFreshness";
import {
  clearWarmState,
  getOwnWriteAt,
  getWarmStore,
  setListEntry,
  setWarmStoreForTests,
} from "./warmCache";
import { OWN_WRITE_SOURCES } from "./warmListeners";
import { OWN_WRITE_SLACK_MS } from "./warmConfig";
import { MemoryWarmStore, warmKey } from "./warmStore";
import { showDashboardPanels } from "./showDashboardPanels";
import { fetchPanels as fetchPanelsRequest } from "../../../panels/services/panelService";
import type { Dashboard } from "../../types/dashboard";
import { deleteOutput } from "../../../pipelines/state/outputsSlice";
import { deletePipeline } from "../../../pipelines/state/pipelinesSlice";
import { deleteSource } from "../../../sources/state/sourcesSlice";
import { getListEntry } from "./warmCache";

jest.mock("../../../panels/services/panelService", () => ({ fetchPanels: jest.fn() }));
jest.mock("../dashboardChangesService", () => ({ fetchDashboardChanges: jest.fn() }));
jest.mock("../../../auth/services/authService", () => ({
  patchDashboardTabsRequest: jest.fn().mockResolvedValue(undefined),
}));

const fetchPanelsMock = jest.mocked(fetchPanelsRequest);
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const panel = (id: string, dashboardId: string) => outputPanel(id, dashboardId, "o1");
const d = (id: string): Dashboard => dash(id);

beforeEach(async () => {
  await clearWarmState();
  resetOutputFreshness();
  setWarmStoreForTests(new MemoryWarmStore());
  fetchPanelsMock.mockReset();
});

/** One row per client content-write success action: the action and the dashboard ids it must record. */
const OWN_WRITE_CASES: Array<[string, unknown, string[]]> = [
  [
    "updatePanelTitle",
    updatePanelTitle.fulfilled(panel("p", "A"), "r", { panelId: "p", title: "t" }),
    ["A"],
  ],
  [
    "updatePanelAppearance",
    updatePanelAppearance.fulfilled(panel("p", "A"), "r", {
      panelId: "p",
      appearance: {} as never,
    }),
    ["A"],
  ],
  [
    "updatePanelTextContent",
    updatePanelTextContent.fulfilled(panel("p", "A"), "r", { panelId: "p", content: "x" }),
    ["A"],
  ],
  [
    "updatePanelMarkdownContent",
    updatePanelMarkdownContent.fulfilled(panel("p", "A"), "r", { panelId: "p", content: "x" }),
    ["A"],
  ],
  ["updatePanelImage", updatePanelImage.fulfilled(panel("p", "A"), "r", {} as never), ["A"]],
  ["updatePanelDivider", updatePanelDivider.fulfilled(panel("p", "A"), "r", {} as never), ["A"]],
  ["updatePanelForm", updatePanelForm.fulfilled(panel("p", "A"), "r", {} as never), ["A"]],
  [
    "updatePanelOutputControls",
    updatePanelOutputControls.fulfilled(panel("p", "A"), "r", {} as never),
    ["A"],
  ],
  ["createPanel", createPanel.fulfilled(panel("p", "A"), "r", {} as never), ["A"]],
  ["duplicatePanel", duplicatePanel.fulfilled(panel("p", "A"), "r", {} as never), ["A"]],
  ["swapPanelOutput", swapPanelOutput.fulfilled(panel("p", "A"), "r", {} as never), ["A"]],
  ["deletePanel", deletePanel.fulfilled("p", "r", { panelId: "p", dashboardId: "A" }), ["A"]],
  [
    "updatePanelsBatch (each response panel's OWN dashboard)",
    updatePanelsBatch.fulfilled(
      { panels: [panel("p1", "A"), panel("p2", "B"), panel("p3", "A")] },
      "r",
      {} as never,
    ),
    ["A", "B"],
  ],
  ["markDashboardPanelsStale (patch-set panel edits)", markDashboardPanelsStale("A"), ["A"]],
  ["renameDashboard", renameDashboard.fulfilled(d("A"), "r", {} as never), ["A"]],
  [
    "updateDashboardAppearance",
    updateDashboardAppearance.fulfilled(d("A"), "r", {} as never),
    ["A"],
  ],
  [
    "updateDashboardLayout",
    updateDashboardLayout.fulfilled(
      d("A"),
      "r",
      { dashboardId: "A", layout: {}, sentLayout: d("A").layout },
      { rebased: false },
    ),
    ["A"],
  ],
  [
    "duplicateDashboard",
    duplicateDashboard.fulfilled({ dashboard: d("A"), panels: [] }, "r", "x"),
    ["A"],
  ],
  [
    "importDashboard",
    importDashboard.fulfilled({ dashboard: d("A"), panels: [] }, "r", {} as never),
    ["A"],
  ],
  [
    "applyProposal",
    applyProposal.fulfilled({ dashboard: d("A"), panels: [] } as never, "r", {} as never),
    ["A"],
  ],
  [
    "applyPatchSet (dashboard-kind edits only)",
    applyPatchSet.fulfilled(
      {
        edits: [
          { index: 0, resultingState: { id: "A" } },
          { index: 1, resultingState: { id: "P" } },
        ],
      } as never,
      "r",
      {
        edits: [{ target: { kind: "dashboard", id: "A" } }, { target: { kind: "panel", id: "P" } }],
      } as never,
    ),
    ["A"],
  ],
  [
    "undoPatchSet (dashboard-kind edits only)",
    undoPatchSet.fulfilled({ edits: [{ index: 0, resultingState: { id: "A" } }] } as never, "r", {
      applicationId: "x",
      patchSet: { edits: [{ target: { kind: "dashboard", id: "A" } }] },
    } as never),
    ["A"],
  ],
];

describe("own-write table (HEL-1575 task 4.0)", () => {
  it.each(OWN_WRITE_CASES)(
    "%s records an own write for exactly the dashboards it wrote",
    (_name, action, expectedIds) => {
      const harness = makeTabsStore({
        dashboards: [d("A"), d("B"), d("C")],
        tabs: [tab("A"), tab("B"), tab("C")],
        activeId: "C",
        selected: "C",
      });
      harness.dispatch(action as never);
      for (const id of ["A", "B", "C"]) {
        const at = getOwnWriteAt(id);
        if (expectedIds.includes(id)) {
          expect(at).not.toBeNull();
          expect(at as number).toBeGreaterThan(Date.now() + OWN_WRITE_SLACK_MS - 2_000);
          // the tab carries it (persisted server-side with the tab)
          expect(
            harness.getState().dashboardTabs.tabs.find((t) => t.id === id)?.ownWriteAt,
          ).not.toBeNull();
        } else {
          expect(at).toBeNull();
          expect(
            harness.getState().dashboardTabs.tabs.find((t) => t.id === id)?.ownWriteAt,
          ).toBeNull();
        }
      }
    },
  );

  it("every source in the table is exercised by a case above", () => {
    expect(OWN_WRITE_CASES.length).toBeGreaterThanOrEqual(OWN_WRITE_SOURCES.length);
    for (const source of OWN_WRITE_SOURCES) {
      const covered = OWN_WRITE_CASES.some(([, action]) => source.matches(action as never));
      expect({ source: source.name, covered }).toEqual({ source: source.name, covered: true });
    }
  });

  it("a rejected write records nothing", () => {
    const harness = makeTabsStore({
      dashboards: [d("A")],
      tabs: [tab("A")],
      activeId: "A",
      selected: "A",
    });
    harness.dispatch(updatePanelTitle.rejected(null, "r", { panelId: "p", title: "t" }, "boom"));
    expect(getOwnWriteAt("A")).toBeNull();
  });

  /** Every service function that issues a write is classified here, so a NEW content-write path cannot be
   *  added without a decision (the executor enumerated these by grep over `services/*`). */
  const SERVICE_WRITES: Record<string, string> = {
    // panelService.ts
    createPanel: "covered: panels/createPanel",
    updatePanelTitle: "covered: panels/updatePanelTitle",
    patchPanelOutputId: "covered: panels/swapPanelOutput",
    deletePanel: "covered: panels/deletePanel",
    duplicatePanel: "covered: panels/duplicatePanel",
    updatePanelAppearance: "covered: panels/updatePanelAppearance",
    updatePanelsBatch: "covered: panels/updatePanelsBatch",
    updatePanelTextContent: "covered: panels/updatePanelTextContent",
    updatePanelMarkdownContent: "covered: panels/updatePanelMarkdownContent",
    updatePanelImage: "covered: panels/updatePanelImage",
    uploadPanelImage:
      "excluded: stores an upload, not a dashboard edit (the panel PATCH that uses it is covered)",
    updatePanelForm: "covered: panels/updatePanelForm",
    updatePanelOutputControls: "covered: panels/updatePanelOutputControls",
    submitFormPanel: "excluded: appends a dataset row (data, not dashboard content)",
    updatePanelDivider: "covered: panels/updatePanelDivider",
    // dashboardService.ts
    createDashboard:
      "excluded: a brand-new dashboard opens as the active tab; it has no warm copy or dot to protect",
    renameDashboard: "covered: dashboards/renameDashboard",
    updateDashboardAppearance: "covered: dashboards/updateDashboardAppearance",
    deleteDashboard: "excluded: the dashboard is gone (its tab is pruned)",
    updateDashboardLayout: "covered: dashboards/updateDashboardLayout",
    repairDashboardLayout:
      "excluded: a one-time repair is not an edit (HEL-1233): the server does not bump last_updated either",
    duplicateDashboard: "covered: dashboards/duplicateDashboard",
    importDashboard: "covered: dashboards/importDashboard",
    // other services
    applyDashboardProposal: "covered: dashboards/applyProposal",
    applyPatchSet: "covered: patchSets/applyPatchSet",
    undoPatchSet: "covered: patchSets/undoPatchSet",
    previewPatchSet: "excluded: a preview writes nothing",
    applyCombinedProposal: "excluded: mints a brand-new dashboard (like createDashboard)",
    moveDashboardToFolder:
      "excluded: folder membership is per-user UI organisation, not dashboard content",
  };

  it("every service function that writes a dashboard or panel is classified (covered or excluded with a reason)", () => {
    const root = join(__dirname, "../../../..");
    const files = [
      "features/panels/services/panelService.ts",
      "features/dashboards/services/dashboardService.ts",
      "features/dashboards/services/proposalService.ts",
      "features/patchSets/services/patchSetService.ts",
      "features/proposals/services/combinedProposalService.ts",
      "features/dashboards/services/dashboardFolderService.ts",
    ];
    const found: string[] = [];
    for (const file of files) {
      const source = readFileSync(join(root, file), "utf8");
      const functions = source.split(/\n(?=export (?:async )?function )/);
      for (const chunk of functions) {
        const name = /^export (?:async )?function (\w+)/.exec(chunk)?.[1];
        if (!name || !/httpClient\.(post|patch|put|delete)\b/.test(chunk)) continue;
        // folder CRUD itself (create/update/delete a folder) never touches a dashboard or panel
        if (/\/api\/dashboard-folders/.test(chunk) && !/\/api\/dashboards\//.test(chunk)) continue;
        found.push(name);
      }
    }
    expect([...new Set(found)].sort()).toEqual(Object.keys(SERVICE_WRITES).sort());
    const covered = Object.values(SERVICE_WRITES)
      .filter((v) => v.startsWith("covered: "))
      .map((v) => v.slice("covered: ".length));
    const names = OWN_WRITE_SOURCES.map((s) => s.name);
    for (const typePrefix of covered) expect(names).toContain(typePrefix);
    for (const [fn, value] of Object.entries(SERVICE_WRITES)) {
      if (value.startsWith("excluded: "))
        expect(value.length).toBeGreaterThan("excluded: ".length + 10);
      expect(fn).toBeTruthy();
    }
  });
});

describe("own-write scenarios (design D4/D7, review note: dot vs warm)", () => {
  it("deferred flush after leave: the ack sets ownWriteAt, so no dot and the tab stays warm", async () => {
    // The user edited a panel title on A, switched to B (the unmount flush is in flight), and the batch
    // success for A's panel lands while B is active.
    const harness = makeTabsStore({
      dashboards: [d("A"), d("B")],
      tabs: [tab("A", ago(60_000)), tab("B", ago(1_000))],
      activeId: "B",
      selected: "B",
      panels: { items: [panel("pb", "B")], loadedDashboardId: "B" },
    });
    setListEntry("A", { panels: [panel("pa", "A")], contentCapturedAt: Date.now() - 120_000 });
    // The write committed 30 s ago on the server => A's panel row last_updated, then the ack arrives now.
    harness.dispatch(
      changeSignalsReceived({
        items: [
          {
            dashboardId: "A",
            contentUpdatedAt: ago(1_000),
            dataUpdatedAt: null,
            outputs: [],
          },
        ],
        serverOffsetMs: 0,
      }),
    );
    expect(selectTabHasChanged(harness.getState(), "A")).toBe(true); // before the ack: looks like a change
    harness.dispatch(updatePanelsBatch.fulfilled({ panels: [panel("pa", "A")] }, "r", {} as never));
    expect(selectTabHasChanged(harness.getState(), "A")).toBe(false); // own edit: no dot
    harness.dispatch(activateTab("A"));
    await harness.dispatch(showDashboardPanels("A"));
    expect(fetchPanelsMock).not.toHaveBeenCalled(); // and still warm
  });

  it("own edit, leave, a run on A: the dot DOES show (own writes never hide new data)", () => {
    const harness = makeTabsStore({
      dashboards: [d("A"), d("B")],
      tabs: [tab("A", ago(60_000)), tab("B", ago(1_000))],
      activeId: "B",
      selected: "B",
    });
    harness.dispatch(updatePanelsBatch.fulfilled({ panels: [panel("pa", "A")] }, "r", {} as never));
    harness.dispatch(
      changeSignalsReceived({
        items: [
          {
            dashboardId: "A",
            contentUpdatedAt: ago(10_000),
            dataUpdatedAt: ago(1_000),
            outputs: [{ outputId: "o1", dataUpdatedAt: ago(1_000) }],
          },
        ],
        serverOffsetMs: 0,
      }),
    );
    expect(selectTabHasChanged(harness.getState(), "A")).toBe(true);
  });

  it("patches a stored browser copy's ownWriteAt when a write lands after the tab was left", async () => {
    const harness = makeTabsStore({
      dashboards: [d("A"), d("B")],
      tabs: [tab("A", ago(60_000)), tab("B")],
      activeId: "B",
      selected: "B",
    });
    await getWarmStore().write(
      storedEntry({ dashboardId: "A", lastViewedAt: Date.now(), ownWriteAt: null }),
    );
    harness.dispatch(updatePanelsBatch.fulfilled({ panels: [panel("pa", "A")] }, "r", {} as never));
    await new Promise((r) => setTimeout(r, 0));
    const stored = await getWarmStore().read("user-1", "A");
    expect(stored?.ownWriteAt).toBe(getOwnWriteAt("A"));
  });
});

describe("clearAuth clears the warm state (design D5, logout and the 401 path)", () => {
  it("empties memory, own writes and retentions, and deletes the stored copy", async () => {
    const raw = new MemoryWarmStore();
    setWarmStoreForTests(raw);
    const harness = makeTabsStore({
      dashboards: [d("A")],
      tabs: [tab("A")],
      activeId: "A",
      selected: "A",
    });
    setListEntry("A", { panels: [panel("pa", "A")], contentCapturedAt: 1 });
    harness.dispatch(updatePanelsBatch.fulfilled({ panels: [panel("pa", "A")] }, "r", {} as never));
    await raw.put(warmKey("user-1", "A"), storedEntry({ dashboardId: "A" }));
    harness.dispatch(clearAuth());
    await new Promise((r) => setTimeout(r, 0));
    expect(getOwnWriteAt("A")).toBeNull();
    expect(await raw.entries()).toEqual([]);
  });
});

describe("client-side deletes drop the affected warm copies (design D6 known gap)", () => {
  async function seed() {
    const harness = makeTabsStore({
      dashboards: [d("A"), d("B")],
      tabs: [tab("A", ago(60_000)), tab("B", ago(60_000))],
      activeId: "A",
      selected: "A",
    });
    setListEntry("A", { panels: [outputPanel("pa", "A", "o1")], contentCapturedAt: 1 });
    setListEntry("B", { panels: [outputPanel("pb", "B", "o2")], contentCapturedAt: 1 });
    await getWarmStore().write(
      storedEntry({
        dashboardId: "A",
        lastViewedAt: Date.now(),
        panels: [outputPanel("pa", "A", "o1")],
      }),
    );
    await getWarmStore().write(
      storedEntry({
        dashboardId: "B",
        lastViewedAt: Date.now(),
        panels: [outputPanel("pb", "B", "o2")],
      }),
    );
    return harness;
  }

  it("deleteOutput drops only the dashboards that bind that Output (memory and browser store)", async () => {
    const harness = await seed();
    harness.dispatch(
      deleteOutput.fulfilled({ outputId: "o1", pipelineId: "pipe" }, "r", {
        outputId: "o1",
        pipelineId: "pipe",
      }),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(getListEntry("A")).toBeUndefined();
    expect(getListEntry("B")).toBeDefined();
    expect(await getWarmStore().read("user-1", "A")).toBeUndefined();
    expect(await getWarmStore().read("user-1", "B")).toBeDefined();
  });

  it.each([
    ["deleteSource", () => deleteSource.fulfilled("src", "r", "src")],
    ["deletePipeline", () => deletePipeline.fulfilled("pipe" as never, "r", "pipe" as never)],
  ])("%s (Outputs not enumerable client-side) drops every warm copy", async (_name, make) => {
    const harness = await seed();
    harness.dispatch(make() as never);
    await new Promise((r) => setTimeout(r, 0));
    expect(getListEntry("A")).toBeUndefined();
    expect(getListEntry("B")).toBeUndefined();
    expect(await getWarmStore().read("user-1", "B")).toBeUndefined();
  });
});
