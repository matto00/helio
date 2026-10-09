import * as outputService from "../../pipelines/services/outputService";
import { httpClient } from "../../../services/httpClient";
import { makeOutput } from "../../../test/remountFixtures";
import {
  REMOUNT_GRACE_MS,
  invalidateAll,
  invalidatePipeline,
  release,
  retain,
} from "./outputFreshness";
import { fetchOutputMeta, getOutputMetaCached } from "./outputMetaCache";

// HEL-1392 design.md D1/D3 -- shared metadata cache: merged in-flight requests, servable only while
// the Output is retained and uninvalidated, failures never cached, and every Output write path
// invalidates it.
jest.mock("../../../services/httpClient", () => ({
  httpClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const http = jest.mocked(httpClient);
const wire = (id: string, config: Record<string, unknown> = {}) => makeOutput(id, "table", config);

let nowSpy: jest.SpyInstance<number, []>;
beforeEach(() => {
  jest.clearAllMocks();
  nowSpy = jest.spyOn(Date, "now");
});
afterEach(() => nowSpy.mockRestore());

describe("outputMetaCache", () => {
  it("merges concurrent consumers of one Output into a single request", async () => {
    http.get.mockResolvedValue({ data: wire("o1") });
    const results = await Promise.all([
      fetchOutputMeta("o1"),
      fetchOutputMeta("o1"),
      fetchOutputMeta("o1"),
    ]);
    expect(http.get).toHaveBeenCalledTimes(1);
    expect(new Set(results.map((r) => r.id))).toEqual(new Set(["o1"]));
  });

  it("never caches a failed fetch", async () => {
    http.get.mockRejectedValueOnce(new Error("429"));
    await expect(fetchOutputMeta("o1")).rejects.toThrow("429");
    retain("o1");
    expect(getOutputMetaCached("o1")).toBeUndefined();
    http.get.mockResolvedValue({ data: wire("o1") });
    await fetchOutputMeta("o1");
    expect(http.get).toHaveBeenCalledTimes(2);
  });

  it("serves a held value to a later mount only while the Output is retained", async () => {
    http.get.mockResolvedValue({ data: wire("o1") });
    await fetchOutputMeta("o1");
    expect(getOutputMetaCached("o1")).toBeUndefined();
    retain("o1");
    expect(getOutputMetaCached("o1")?.id).toBe("o1");
    release("o1");
    const t0 = Date.now();
    nowSpy.mockReturnValue(t0 + REMOUNT_GRACE_MS - 1_000);
    expect(getOutputMetaCached("o1")?.id).toBe("o1");
    nowSpy.mockReturnValue(t0 + REMOUNT_GRACE_MS + 1);
    expect(getOutputMetaCached("o1")).toBeUndefined();
    await fetchOutputMeta("o1");
    expect(http.get).toHaveBeenCalledTimes(2);
  });

  it("stays servable however long the card has been mounted (retention, not fetch age)", async () => {
    http.get.mockResolvedValue({ data: wire("o1") });
    await fetchOutputMeta("o1");
    retain("o1");
    nowSpy.mockReturnValue(Date.now() + 10 * REMOUNT_GRACE_MS);
    expect(getOutputMetaCached("o1")?.id).toBe("o1");
  });

  it("a net retain/release pair from StrictMode's cleanup/re-run leaves the Output retained", () => {
    retain("o1");
    release("o1");
    retain("o1");
    nowSpy.mockReturnValue(Date.now() + 10 * REMOUNT_GRACE_MS);
    http.get.mockResolvedValue({ data: wire("o1") });
    return fetchOutputMeta("o1").then(() => expect(getOutputMetaCached("o1")?.id).toBe("o1"));
  });

  it("an update then a remount issues one fresh request and renders the edited config", async () => {
    http.get.mockResolvedValueOnce({ data: wire("o1", { chartType: "bar" }) });
    await fetchOutputMeta("o1");
    retain("o1");
    http.patch.mockResolvedValue({ data: wire("o1", { chartType: "line" }) });
    await outputService.updateOutput("o1", { config: { chartType: "line" } });
    expect(getOutputMetaCached("o1")).toBeUndefined();
    http.get.mockResolvedValueOnce({ data: wire("o1", { chartType: "line" }) });
    const fresh = await fetchOutputMeta("o1");
    expect(http.get).toHaveBeenCalledTimes(2);
    expect(fresh.config).toEqual({ chartType: "line" });
  });

  it.each([
    ["delete", () => outputService.deleteOutput("o1")],
    [
      "create on its pipeline",
      () => outputService.createOutput("pipeline-o1", { kind: "table", name: "n" } as never),
    ],
  ])("a %s invalidates the held metadata", async (_name, write) => {
    http.get.mockResolvedValue({ data: wire("o1") });
    http.delete.mockResolvedValue({ data: {} });
    http.post.mockResolvedValue({ data: wire("o2") });
    await fetchOutputMeta("o1");
    retain("o1");
    await write();
    expect(getOutputMetaCached("o1")).toBeUndefined();
  });

  it("a pipeline or global invalidation makes the held metadata unservable", async () => {
    http.get.mockResolvedValue({ data: wire("o1") });
    await fetchOutputMeta("o1");
    retain("o1");
    invalidatePipeline("pipeline-o1");
    expect(getOutputMetaCached("o1")).toBeUndefined();
    await fetchOutputMeta("o1");
    expect(getOutputMetaCached("o1")?.id).toBe("o1");
    invalidateAll();
    expect(getOutputMetaCached("o1")).toBeUndefined();
  });

  it("does not serve a result that an invalidation overtook while it was in flight", async () => {
    let resolve!: (v: { data: ReturnType<typeof wire> }) => void;
    http.get.mockReturnValueOnce(new Promise((res) => (resolve = res)));
    const pending = fetchOutputMeta("o1");
    retain("o1");
    invalidateAll();
    resolve({ data: wire("o1") });
    await pending;
    expect(getOutputMetaCached("o1")).toBeUndefined();
  });
});
