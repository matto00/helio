// HEL-1780 D5: per-panel capabilities (the per-panel route, already narrowed to that panel's own control columns) are keyed by
// (dashboardId, panelId), never by Output: two panels bound to one Output with different controls keep different entries.
import { fetchPublicFilterCapabilities } from "../../dashboards/services/publicDashboardService";
import {
  ensureCapabilitiesLoaded,
  getCapabilitiesEntry,
  invalidateCapabilities,
  loadPanelCapabilities,
  panelCapabilitiesKey,
  resetCapabilitiesStoreForTests,
} from "./filterCapabilitiesStore";

jest.mock("../../dashboards/services/publicDashboardService");
jest.mock("../../pipelines/services/outputService", () => ({ getFilterCapabilities: jest.fn() }));
const perPanel = jest.mocked(fetchPublicFilterCapabilities);
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  jest.clearAllMocks();
  resetCapabilitiesStoreForTests();
});

describe("per-panel filter capabilities (HEL-1780 D5)", () => {
  it("two panels on one Output keep their own capabilities, and invalidating one leaves the other", async () => {
    perPanel.mockImplementation(async (_d, panelId) => ({
      columns: [{ column: panelId === "p1" ? "team" : "region", operators: ["eq"] }],
    }));
    const k1 = panelCapabilitiesKey("d", "p1");
    const k2 = panelCapabilitiesKey("d", "p2");
    expect(k1).not.toBe(k2);
    ensureCapabilitiesLoaded(k1, loadPanelCapabilities("d", "p1"));
    ensureCapabilitiesLoaded(k2, loadPanelCapabilities("d", "p2"));
    await flush();
    const e1 = getCapabilitiesEntry(k1);
    const e2 = getCapabilitiesEntry(k2);
    expect(e1?.status === "ready" && [...e1.columns.keys()]).toEqual(["team"]);
    expect(e2?.status === "ready" && [...e2.columns.keys()]).toEqual(["region"]);
    // no token is sent (a signed-in grantee)
    expect(perPanel).toHaveBeenCalledWith("d", "p1");

    invalidateCapabilities(k1);
    expect(getCapabilitiesEntry(k1)?.status).toBe("unavailable");
    expect(getCapabilitiesEntry(k2)?.status).toBe("ready");
  });

  it("a per-panel key never collides with an Output id", () => {
    expect(panelCapabilitiesKey("d", "p")).not.toBe("p");
  });
});
