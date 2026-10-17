import { configureStore } from "@reduxjs/toolkit";

import { clearAuth } from "../../auth/state/authSlice";
import { Integral } from "../../pipelines/evaluator/value";
import type { PipelineRoot } from "../../pipelines/types/pipelineStep";
import * as dataSourceService from "../services/dataSourceService";
import { sample } from "../test/sampleFixtures";
import {
  fetchSourceSample,
  sampleFrame,
  selectRootFrames,
  selectSourceFrames,
  selectSourceSample,
  sourceSamplesReducer,
} from "./sourceSamplesSlice";

jest.mock("../services/dataSourceService", () => ({ fetchSourceSample: jest.fn() }));
const fetchMock = jest.mocked(dataSourceService.fetchSourceSample);

function makeStore() {
  return configureStore({ reducer: { sourceSamples: sourceSamplesReducer } });
}

beforeEach(() => fetchMock.mockReset());

describe("sourceSamplesSlice capture-once semantics", () => {
  it("captures a source once and never re-fetches it without force", async () => {
    fetchMock.mockResolvedValue(sample());
    const store = makeStore();
    await store.dispatch(fetchSourceSample({ sourceId: "s1" }));
    await store.dispatch(fetchSourceSample({ sourceId: "s1" }));
    await store.dispatch(fetchSourceSample({ sourceId: "s1" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store.getState().sourceSamples.entries.s1.status).toBe("ready");
  });

  it("skips a dispatch while the same source is loading", async () => {
    let resolve: (s: ReturnType<typeof sample>) => void = () => {};
    fetchMock.mockReturnValue(new Promise((r) => (resolve = r)));
    const store = makeStore();
    const first = store.dispatch(fetchSourceSample({ sourceId: "s1" }));
    await store.dispatch(fetchSourceSample({ sourceId: "s1", force: true }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolve(sample());
    await first;
    expect(store.getState().sourceSamples.entries.s1.status).toBe("ready");
  });

  it("re-fetches exactly once on a forced refresh, keeping the old sample while loading", async () => {
    fetchMock.mockResolvedValueOnce(sample({ capturedAt: "2026-10-16T12:00:00Z" }));
    const store = makeStore();
    await store.dispatch(fetchSourceSample({ sourceId: "s1" }));
    fetchMock.mockResolvedValueOnce(sample({ capturedAt: "2026-10-16T12:05:00Z" }));
    const refresh = store.dispatch(fetchSourceSample({ sourceId: "s1", force: true }));
    expect(store.getState().sourceSamples.entries.s1.status).toBe("loading");
    expect(store.getState().sourceSamples.entries.s1.sample?.capturedAt).toBe(
      "2026-10-16T12:00:00Z",
    );
    await refresh;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(selectSourceSample(store.getState(), "s1")?.capturedAt).toBe("2026-10-16T12:05:00Z");
  });

  it("does not retry a failed first capture on its own, but a forced refresh recovers", async () => {
    fetchMock.mockRejectedValueOnce(new Error("boom"));
    const store = makeStore();
    await store.dispatch(fetchSourceSample({ sourceId: "s1" }));
    expect(store.getState().sourceSamples.entries.s1.status).toBe("error");
    await store.dispatch(fetchSourceSample({ sourceId: "s1" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValueOnce(sample());
    await store.dispatch(fetchSourceSample({ sourceId: "s1", force: true }));
    expect(store.getState().sourceSamples.entries.s1.status).toBe("ready");
  });

  it("keeps the last good sample through a failed refresh", async () => {
    fetchMock.mockResolvedValueOnce(sample());
    const store = makeStore();
    await store.dispatch(fetchSourceSample({ sourceId: "s1" }));
    fetchMock.mockRejectedValueOnce(new Error("boom"));
    await store.dispatch(fetchSourceSample({ sourceId: "s1", force: true }));
    const entry = store.getState().sourceSamples.entries.s1;
    expect(entry.status).toBe("error");
    expect(entry.sample).toBeDefined();
  });

  it("reads and writes nothing in browser storage, and a fresh store holds nothing", async () => {
    const get = jest.spyOn(Storage.prototype, "getItem");
    const set = jest.spyOn(Storage.prototype, "setItem");
    fetchMock.mockResolvedValue(sample());
    const store = makeStore();
    await store.dispatch(fetchSourceSample({ sourceId: "s1" }));
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(makeStore().getState().sourceSamples.entries).toEqual({});
    get.mockRestore();
    set.mockRestore();
  });
});

describe("sourceSamplesSlice sign-out", () => {
  it("clears every sample on sign-out", async () => {
    fetchMock.mockResolvedValue(sample());
    const store = makeStore();
    await store.dispatch(fetchSourceSample({ sourceId: "s1" }));
    store.dispatch(clearAuth());
    expect(store.getState().sourceSamples.entries).toEqual({});
  });

  it("ignores a response that lands after sign-out", async () => {
    let resolve: (s: ReturnType<typeof sample>) => void = () => {};
    fetchMock.mockReturnValue(new Promise((r) => (resolve = r)));
    const store = makeStore();
    const inFlight = store.dispatch(fetchSourceSample({ sourceId: "s1" }));
    store.dispatch(clearAuth());
    resolve(sample());
    await inFlight;
    expect(store.getState().sourceSamples.entries).toEqual({});
  });

  it("ignores a failure that lands after sign-out", async () => {
    let reject: (e: Error) => void = () => {};
    fetchMock.mockReturnValue(new Promise((_, r) => (reject = r)));
    const store = makeStore();
    const inFlight = store.dispatch(fetchSourceSample({ sourceId: "s1" }));
    store.dispatch(clearAuth());
    reject(new Error("late"));
    await inFlight;
    expect(store.getState().sourceSamples.entries).toEqual({});
  });
});

describe("sourceSamplesSlice evaluator selectors", () => {
  const roots: PipelineRoot[] = [
    { id: "root-a", dataSourceId: "s1", dataSourceName: "One" },
    { id: "root-b", dataSourceId: "s2", dataSourceName: "Two" },
  ];

  async function loaded() {
    fetchMock.mockImplementation(async (id) =>
      id === "s1"
        ? sample({ rows: [{ n: { $int: 7 }, big: { $long: "9" } }], truncated: false })
        : sample({ rows: [{ x: 1.5 }], truncated: true, sourceRowCount: null, live: true }),
    );
    const store = makeStore();
    await store.dispatch(fetchSourceSample({ sourceId: "s1" }));
    await store.dispatch(fetchSourceSample({ sourceId: "s2" }));
    return store;
  }

  it("decodes rows into the evaluator's value model, keyed by pipeline root id", async () => {
    const store = await loaded();
    const frames = selectRootFrames(store.getState(), roots);
    expect(frames.map((f) => f.rootId)).toEqual(["root-a", "root-b"]);
    const n = frames[0].rows[0].n;
    expect(n).toBeInstanceOf(Integral);
    expect((n as Integral).kind).toBe("int");
    expect(frames[1].rows[0].x).toBe(1.5);
  });

  it("marks a truncated sample incomplete", async () => {
    const store = await loaded();
    const frames = selectSourceFrames(store.getState(), ["s1", "s2"]);
    expect(frames.s1.complete).toBe(true);
    expect(frames.s2.complete).toBe(false);
  });

  it("omits a source with no sample, and keeps frame identity until it is refreshed", async () => {
    const store = await loaded();
    expect(Object.keys(selectSourceFrames(store.getState(), ["s1", "missing"]))).toEqual(["s1"]);
    const before = selectRootFrames(store.getState(), roots)[0].rows;
    expect(selectRootFrames(store.getState(), roots)[0].rows).toBe(before);
    const s1 = selectSourceSample(store.getState(), "s1")!;
    expect(sampleFrame(s1)).toBe(before);
    fetchMock.mockResolvedValueOnce(sample({ rows: [{ n: { $int: 8 } }] }));
    await store.dispatch(fetchSourceSample({ sourceId: "s1", force: true }));
    expect(selectRootFrames(store.getState(), roots)[0].rows).not.toBe(before);
  });
});
