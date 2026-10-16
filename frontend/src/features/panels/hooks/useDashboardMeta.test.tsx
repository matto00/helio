import { act, renderHook, waitFor } from "@testing-library/react";

import { getPipelineById } from "../../pipelines/services/pipelineService";
import type { Output } from "../../pipelines/types/output";
import type { PipelineSummary } from "../../pipelines/types/pipelineStep";
import { makeFormPanel, makeOutputPanel } from "../../../test/panelFixtures";
import { subscribeToPipelineTerminal } from "../services/pipelineRunFanout";
import { fetchOutputMeta, getOutputMetaCached } from "../state/outputMetaCache";
import { useDashboardMeta } from "./useDashboardMeta";

jest.mock("../../pipelines/services/pipelineService", () => ({ getPipelineById: jest.fn() }));
jest.mock("../services/pipelineRunFanout", () => ({ subscribeToPipelineTerminal: jest.fn() }));
jest.mock("../state/outputMetaCache", () => ({
  fetchOutputMeta: jest.fn(),
  getOutputMetaCached: jest.fn(),
}));

const getPipeline = jest.mocked(getPipelineById);
const subscribe = jest.mocked(subscribeToPipelineTerminal);
const fetchOutput = jest.mocked(fetchOutputMeta);
const cached = jest.mocked(getOutputMetaCached);

const output = (id: string, pipelineId: string): Output => ({
  id,
  pipelineId,
  ownerId: "u1",
  name: id,
  kind: "table",
  config: {},
  schema: [],
  createdAt: "",
  updatedAt: "",
});

const summary = (
  id: string,
  lastRunAt: string | null,
  sources: string[] = ["Orders"],
): PipelineSummary => ({
  id,
  name: id,
  roots: sources.map((name, i) => ({
    id: `${id}-r${i}`,
    dataSourceId: `d${i}`,
    dataSourceName: name,
  })),
  lastRunStatus: lastRunAt ? "succeeded" : null,
  lastRunAt,
  lastRunRowCount: null,
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const panels = [makeOutputPanel({ id: "p1", config: { outputId: "o1" } })];
let terminalListeners: Map<string, () => void>;
let unsubscribed: string[];

beforeEach(() => {
  jest.resetAllMocks();
  terminalListeners = new Map();
  unsubscribed = [];
  cached.mockReturnValue(undefined);
  fetchOutput.mockImplementation((id) => Promise.resolve(output(id, `pl-${id}`)));
  subscribe.mockImplementation((id, listener) => {
    terminalListeners.set(id, listener);
    return () => {
      unsubscribed.push(id);
      terminalListeners.delete(id);
    };
  });
});

describe("useDashboardMeta", () => {
  it("(a) the mount read wins: it reads getPipelineById on mount, never a held/stale summary", async () => {
    getPipeline.mockResolvedValue(summary("pl-o1", "2026-10-15T09:00:00Z"));
    const { result } = renderHook(() => useDashboardMeta("d1", panels));
    await waitFor(() => expect(result.current.refreshedAt).toBe("2026-10-15T09:00:00Z"));
    expect(getPipeline).toHaveBeenCalledTimes(1);
    expect(getPipeline).toHaveBeenCalledWith("pl-o1");
    expect(result.current.sources).toEqual(["Orders"]);
  });

  it("(b) a terminal event for a feeding pipeline updates refreshedAt without remount", async () => {
    getPipeline.mockResolvedValueOnce(summary("pl-o1", "2026-10-15T09:00:00Z"));
    const { result } = renderHook(() => useDashboardMeta("d1", panels));
    await waitFor(() => expect(result.current.refreshedAt).toBe("2026-10-15T09:00:00Z"));
    getPipeline.mockResolvedValueOnce(summary("pl-o1", "2026-10-15T10:00:00Z"));
    act(() => terminalListeners.get("pl-o1")?.());
    await waitFor(() => expect(result.current.refreshedAt).toBe("2026-10-15T10:00:00Z"));
    expect(getPipeline).toHaveBeenCalledTimes(2);
  });

  it("(c) out-of-order responses for one id keep the newest request's result", async () => {
    const first = deferred<PipelineSummary>();
    const second = deferred<PipelineSummary>();
    getPipeline.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useDashboardMeta("d1", panels));
    await waitFor(() => expect(getPipeline).toHaveBeenCalledTimes(1));
    act(() => terminalListeners.get("pl-o1")?.());
    expect(getPipeline).toHaveBeenCalledTimes(2);
    await act(async () => second.resolve(summary("pl-o1", "2026-10-15T10:00:00Z")));
    await act(async () => first.resolve(summary("pl-o1", "2026-10-15T08:00:00Z")));
    expect(result.current.refreshedAt).toBe("2026-10-15T10:00:00Z");
  });

  it("(d) unmount unsubscribes, and a response arriving afterwards is harmless", async () => {
    const late = deferred<PipelineSummary>();
    getPipeline.mockReturnValue(late.promise);
    const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const { result, unmount } = renderHook(() => useDashboardMeta("d1", panels));
    await waitFor(() => expect(subscribe).toHaveBeenCalledWith("pl-o1", expect.any(Function)));
    unmount();
    expect(unsubscribed).toEqual(["pl-o1"]);
    await act(async () => late.resolve(summary("pl-o1", "2026-10-15T10:00:00Z")));
    expect(result.current.refreshState).toBe("unknown");
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("(e) a 403/404 omits the facts", async () => {
    getPipeline.mockRejectedValue({ response: { status: 403 } });
    const { result } = renderHook(() => useDashboardMeta("d1", panels));
    await waitFor(() => expect(getPipeline).toHaveBeenCalled());
    await act(async () => undefined);
    expect(result.current).toMatchObject({
      refreshState: "unknown",
      refreshedAt: null,
      sources: [],
    });
  });

  it("(e2) a failed re-read after a good one drops the earlier value instead of keeping it", async () => {
    getPipeline.mockResolvedValueOnce(summary("pl-o1", "2026-10-15T09:00:00Z"));
    const { result } = renderHook(() => useDashboardMeta("d1", panels));
    await waitFor(() => expect(result.current.refreshState).toBe("ran"));
    getPipeline.mockRejectedValueOnce(new Error("404"));
    act(() => terminalListeners.get("pl-o1")?.());
    await waitFor(() => expect(result.current.refreshState).toBe("unknown"));
  });

  it("(f) a panel with an empty outputId is skipped with no fetch", async () => {
    const unbound = [makeOutputPanel({ id: "p0", config: { outputId: "" } })];
    const { result } = renderHook(() => useDashboardMeta("d1", unbound));
    await act(async () => undefined);
    expect(fetchOutput).not.toHaveBeenCalled();
    expect(getPipeline).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    expect(result.current.panelCount).toBe(1);
    expect(result.current.refreshState).toBe("unknown");
  });

  it("(g) form panels contribute nothing to sources or refresh", async () => {
    const forms = [makeFormPanel({ id: "f1", config: { dataSourceId: "ds-1" } })];
    const { result } = renderHook(() => useDashboardMeta("d1", forms));
    await act(async () => undefined);
    expect(fetchOutput).not.toHaveBeenCalled();
    expect(getPipeline).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ panelCount: 1, refreshState: "unknown", sources: [] });
  });

  it("a held Output is used synchronously (no fetch) and still triggers the pipeline read", async () => {
    cached.mockImplementation((id) => output(id, `pl-${id}`));
    getPipeline.mockResolvedValue(summary("pl-o1", "2026-10-15T09:00:00Z"));
    const { result } = renderHook(() => useDashboardMeta("d1", panels));
    await waitFor(() => expect(result.current.refreshState).toBe("ran"));
    expect(fetchOutput).not.toHaveBeenCalled();
  });

  it("a newly added feeding pipeline is read once; the existing one is not re-read", async () => {
    getPipeline.mockImplementation((id) => Promise.resolve(summary(id, "2026-10-15T09:00:00Z")));
    const { rerender } = renderHook(({ ps }) => useDashboardMeta("d1", ps), {
      initialProps: { ps: panels },
    });
    await waitFor(() => expect(getPipeline).toHaveBeenCalledTimes(1));
    rerender({
      ps: [...panels, makeOutputPanel({ id: "p2", config: { outputId: "o2" } })],
    });
    await waitFor(() => expect(getPipeline).toHaveBeenCalledTimes(2));
    expect(getPipeline.mock.calls.map((c) => c[0])).toEqual(["pl-o1", "pl-o2"]);
  });

  it("a feeding pipeline that leaves the panel set is unsubscribed", async () => {
    getPipeline.mockResolvedValue(summary("pl-o1", "2026-10-15T09:00:00Z"));
    const { rerender } = renderHook(({ ps }) => useDashboardMeta("d1", ps), {
      initialProps: { ps: panels },
    });
    await waitFor(() => expect(subscribe).toHaveBeenCalledTimes(1));
    rerender({ ps: [] });
    expect(unsubscribed).toEqual(["pl-o1"]);
  });
});
