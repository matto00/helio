import * as outputService from "../../pipelines/services/outputService";
import {
  CAPABILITIES_TTL_MS,
  ensureCapabilitiesLoaded,
  getCapabilitiesEntry,
  invalidateCapabilities,
  resetCapabilitiesStoreForTests,
  subscribeCapabilities,
} from "./filterCapabilitiesStore";

jest.mock("../../pipelines/services/outputService", () => ({
  getFilterCapabilities: jest.fn(),
}));
const getFilterCapabilities = jest.mocked(outputService.getFilterCapabilities);
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  resetCapabilitiesStoreForTests();
  getFilterCapabilities.mockResolvedValue({ columns: [{ column: "q", operators: ["eq", "in"] }] });
});

describe("filterCapabilitiesStore (HEL-1191 D3a)", () => {
  it("loads once per Output and shares the entry", async () => {
    ensureCapabilitiesLoaded("o1");
    ensureCapabilitiesLoaded("o1");
    await flush();

    expect(getFilterCapabilities).toHaveBeenCalledTimes(1);
    const entry = getCapabilitiesEntry("o1");
    expect(entry?.status === "ready" && entry.columns.get("q")?.has("eq")).toBe(true);
  });

  it("notifies subscribers on load and on invalidation", async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeCapabilities(listener);
    ensureCapabilitiesLoaded("o1");
    await flush();
    const afterLoad = listener.mock.calls.length;
    invalidateCapabilities("o1");

    expect(afterLoad).toBeGreaterThanOrEqual(2);
    expect(listener.mock.calls.length).toBe(afterLoad + 1);
    unsubscribe();
  });

  it("a failed load is an unavailable entry", async () => {
    getFilterCapabilities.mockRejectedValue(new Error("nope"));
    ensureCapabilitiesLoaded("o1");
    await flush();

    expect(getCapabilitiesEntry("o1")?.status).toBe("unavailable");
  });

  it("invalidation blocks (rather than deletes) so a still-eq-listing contract cannot loop", async () => {
    ensureCapabilitiesLoaded("o1");
    await flush();
    invalidateCapabilities("o1");
    ensureCapabilitiesLoaded("o1");
    await flush();

    expect(getFilterCapabilities).toHaveBeenCalledTimes(1);
    expect(getCapabilitiesEntry("o1")?.status).toBe("unavailable");
  });

  it("entries expire after the 5-minute TTL and are then re-fetched", async () => {
    const now = jest.spyOn(Date, "now");
    now.mockReturnValue(1_000);
    ensureCapabilitiesLoaded("o1");
    await flush();
    expect(getCapabilitiesEntry("o1")?.status).toBe("ready");

    now.mockReturnValue(1_000 + CAPABILITIES_TTL_MS - 1);
    expect(getCapabilitiesEntry("o1")?.status).toBe("ready");

    now.mockReturnValue(1_000 + CAPABILITIES_TTL_MS);
    expect(getCapabilitiesEntry("o1")).toBeUndefined();
    ensureCapabilitiesLoaded("o1");
    await flush();
    expect(getFilterCapabilities).toHaveBeenCalledTimes(2);
  });
});
