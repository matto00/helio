// HEL-1773 evaluation-1 CR1: an Output's metadata read through a shared dashboard's per-panel route is a STUB (no owner, no
// pipeline). An owned dashboard must never render it: not from the shared cache, not from a warm capture, not from a warm restore.
import { fetchPublicOutputMeta } from "../../dashboards/services/publicDashboardService";
import { getOutputById } from "../../pipelines/services/outputService";
import { dash, makeTabsStore, tab } from "../../../test/tabsTestStore";
import { outputPanel } from "../../../test/warmFixtures";
import { showDashboardPanels } from "../../dashboards/tabs/warm/showDashboardPanels";
import {
  clearWarmState,
  setListEntry,
  setWarmStoreForTests,
} from "../../dashboards/tabs/warm/warmCache";
import { MemoryWarmStore } from "../../dashboards/tabs/warm/warmStore";
import { resetOutputFreshness, retain } from "./outputFreshness";
import {
  fetchOutputMeta,
  getOutputMetaCached,
  getOutputPanelScope,
  peekOutputMeta,
  scopeOutputToPanel,
  unscopeOutput,
} from "./outputMetaCache";

jest.mock("../../dashboards/services/publicDashboardService");
jest.mock("../../pipelines/services/outputService");
jest.mock("../services/panelService", () => ({ fetchPanels: jest.fn() }));
jest.mock("../../dashboards/tabs/dashboardChangesService", () => ({
  fetchDashboardChanges: jest.fn(),
}));
jest.mock("../../auth/services/authService", () => ({
  patchDashboardTabsRequest: jest.fn().mockResolvedValue(undefined),
}));

const realOutput = {
  id: "o1",
  pipelineId: "pl-real",
  ownerId: "me",
  name: "Real",
  kind: "table",
  config: {},
  schema: [],
  createdAt: "",
  updatedAt: "",
};
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

beforeEach(async () => {
  jest.resetAllMocks();
  resetOutputFreshness();
  await clearWarmState();
  setWarmStoreForTests(new MemoryWarmStore());
  jest
    .mocked(fetchPublicOutputMeta)
    .mockResolvedValue({ kind: "table", config: {}, schema: [], ownerId: null });
  jest.mocked(getOutputById).mockResolvedValue(realOutput);
  // A card on screen retains its Output, which is what lets the cache serve a held value.
  retain("o1");
});

describe("panel-scoped Output metadata never reaches an owned dashboard", () => {
  it("(a) after the scope is cleared the next read goes through the Output route, not the cached stub", async () => {
    scopeOutputToPanel("o1", "shared", "p-shared");
    const stub = await fetchOutputMeta("o1");
    expect(stub.ownerId).toBe("");

    unscopeOutput("o1");
    expect(getOutputMetaCached("o1")).toBeUndefined();
    const real = await fetchOutputMeta("o1");
    expect(getOutputById).toHaveBeenCalledWith("o1");
    expect(real).toMatchObject({ ownerId: "me", pipelineId: "pl-real" });
  });

  it("(a) the reverse: a scope set after an owner read serves no owner copy", async () => {
    await fetchOutputMeta("o1");
    scopeOutputToPanel("o1", "shared", "p-shared");
    expect(getOutputMetaCached("o1")).toBeUndefined();
    const scoped = await fetchOutputMeta("o1");
    expect(fetchPublicOutputMeta).toHaveBeenCalledWith("shared", "p-shared");
    expect(scoped.ownerId).toBe("");
  });

  it("(c) a scoped stub is never exposed to the warm capture", async () => {
    scopeOutputToPanel("o1", "shared", "p-shared");
    await fetchOutputMeta("o1");
    expect(peekOutputMeta("o1")).toBeUndefined();
  });

  it("(b) restoring an owned dashboard from the warm cache clears the scope of its Outputs", async () => {
    scopeOutputToPanel("o1", "shared", "p-shared");
    const panelsA = [outputPanel("pa1", "a", "o1")];
    const { dispatch } = makeTabsStore({
      dashboards: [{ ...dash("a"), accessRole: "owner" }, dash("b")],
      tabs: [tab("a", ago(60_000)), tab("b", ago(1_000))],
      activeId: "a",
      selected: "a",
      panels: { items: [outputPanel("pb1", "b", "o9")], loadedDashboardId: "b" },
      changeSignals: {
        a: { dashboardId: "a", contentUpdatedAt: ago(3_600_000), dataUpdatedAt: null, outputs: [] },
      },
    });
    setListEntry("a", { panels: panelsA, contentCapturedAt: Date.now() - 30 * 60_000 });
    await dispatch(showDashboardPanels("a"));
    expect(getOutputPanelScope("o1")).toBeUndefined();
  });
});
