import { configureStore } from "@reduxjs/toolkit";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, StrictMode, type PropsWithChildren } from "react";
import { Provider } from "react-redux";

import { fetchPanelPage, panelsReducer } from "../state/panelsSlice";
import {
  REMOUNT_GRACE_MS,
  invalidateOutput,
  invalidatePipeline,
  release,
  retain,
} from "../state/outputFreshness";
import { fetchOutputMeta } from "../state/outputMetaCache";
import * as outputService from "../../pipelines/services/outputService";
import { hasRunBaseline } from "../services/pipelineRunFanout";
import { makeOutputPanel } from "../../../test/panelFixtures";
import { makeOutput } from "../../../test/remountFixtures";
import { usePanelData } from "./usePanelData";

// HEL-1392 design.md D2/D8 -- a card that mounts while the store already holds the exact window it
// would request must not request it again; everything else must still fetch.
jest.mock("../../pipelines/services/outputService", () => ({
  ...jest.requireActual("../../pipelines/services/outputService"),
  getOutputRows: jest.fn(),
  getOutputById: jest.fn(),
}));
jest.mock("../services/pipelineRunFanout", () => ({ hasRunBaseline: jest.fn() }));

const rows = outputService.getOutputRows as jest.MockedFunction<typeof outputService.getOutputRows>;
const byId = outputService.getOutputById as jest.MockedFunction<typeof outputService.getOutputById>;
const baseline = hasRunBaseline as jest.MockedFunction<typeof hasRunBaseline>;

const OK = { items: [{ a: 1 }], total: 1, offset: 0, limit: 200, materialized: true };
const panel = makeOutputPanel({ id: "p1", config: { outputId: "o1" } });

function makeStore() {
  return configureStore({
    reducer: { panels: panelsReducer } as never,
    preloadedState: {
      panels: { ...panelsReducer(undefined, { type: "@@INIT" }), items: [panel] },
    } as never,
  });
}
type Store = ReturnType<typeof makeStore>;

const wrap = (store: Store, strict = false) =>
  function Wrapper({ children }: PropsWithChildren) {
    const provider = createElement(Provider, { store } as never, children);
    return strict ? createElement(StrictMode, null, provider) : provider;
  };

/** Metadata held and the Output retained -- the state a card leaves behind across a swap. */
async function holdMeta(outputId = "o1"): Promise<void> {
  byId.mockResolvedValue(makeOutput(outputId, "table", {}));
  await fetchOutputMeta(outputId);
  retain(outputId);
}

async function firstLoad(store: Store): Promise<void> {
  const first = renderHook(() => usePanelData(panel), { wrapper: wrap(store) });
  await waitFor(() => expect(first.result.current.rawRows).not.toBeNull());
  first.unmount();
}

let nowSpy: jest.SpyInstance<number, []>;

describe("usePanelData remount reuse", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    rows.mockResolvedValue(OK);
    baseline.mockReturnValue(true);
  });

  it("serves a held window without a request, and renders it at once", async () => {
    const store = makeStore();
    await holdMeta();
    await firstLoad(store);
    const second = renderHook(() => usePanelData(panel), { wrapper: wrap(store) });
    expect(second.result.current.isLoading).toBe(false);
    expect(second.result.current.rawRows).toEqual([["1"]]);
    expect(rows).toHaveBeenCalledTimes(1);
  });

  it("fetches when the Output is no longer retained", async () => {
    nowSpy = jest.spyOn(Date, "now");
    try {
      const store = makeStore();
      await holdMeta();
      await firstLoad(store);
      release("o1");
      nowSpy.mockReturnValue(Date.now() + REMOUNT_GRACE_MS + 1);
      renderHook(() => usePanelData(panel), { wrapper: wrap(store) });
      await waitFor(() => expect(rows).toHaveBeenCalledTimes(2));
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("still serves it within the grace window after the last card left", async () => {
    nowSpy = jest.spyOn(Date, "now");
    try {
      const store = makeStore();
      await holdMeta();
      await firstLoad(store);
      release("o1");
      nowSpy.mockReturnValue(Date.now() + REMOUNT_GRACE_MS - 1_000);
      renderHook(() => usePanelData(panel), { wrapper: wrap(store) });
      expect(rows).toHaveBeenCalledTimes(1);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("fetches when the bound pipeline has no run baseline", async () => {
    const store = makeStore();
    await holdMeta();
    await firstLoad(store);
    baseline.mockReturnValue(false);
    renderHook(() => usePanelData(panel), { wrapper: wrap(store) });
    await waitFor(() => expect(rows).toHaveBeenCalledTimes(2));
  });

  it.each([
    ["an Output write", () => invalidateOutput("o1")],
    ["a pipeline write or run", () => invalidatePipeline("pipeline-o1")],
  ])("fetches after %s", async (_name, invalidate) => {
    const store = makeStore();
    await holdMeta();
    await firstLoad(store);
    invalidate();
    renderHook(() => usePanelData(panel), { wrapper: wrap(store) });
    await waitFor(() => expect(rows).toHaveBeenCalledTimes(2));
  });

  it("fetches again after the last page-0 request failed (e.g. a 429), and shows the error", async () => {
    const store = makeStore();
    await holdMeta();
    rows.mockRejectedValueOnce(new Error("Rate limit exceeded"));
    const first = renderHook(() => usePanelData(panel), { wrapper: wrap(store) });
    await waitFor(() => expect(first.result.current.error).not.toBeNull());
    first.unmount();
    const second = renderHook(() => usePanelData(panel), { wrapper: wrap(store) });
    await waitFor(() => expect(rows).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(second.result.current.rawRows).not.toBeNull());
  });

  it("an in-flight request is shared, and its failure is an error, not an empty state", async () => {
    const store = makeStore();
    await holdMeta();
    let reject!: (e: Error) => void;
    rows.mockReturnValueOnce(new Promise((_, rej) => (reject = rej)));
    const owner = renderHook(() => usePanelData(panel), { wrapper: wrap(store) });
    const waiter = renderHook(() => usePanelData(panel), { wrapper: wrap(store) });
    await waitFor(() => expect(rows).toHaveBeenCalledTimes(1));
    expect(waiter.result.current.isLoading).toBe(true);
    await act(async () => reject(new Error("boom")));
    await waitFor(() => expect(waiter.result.current.error).toBe("Failed to load panel data."));
    expect(waiter.result.current.noData).toBe(false);
    expect(rows).toHaveBeenCalledTimes(1);
    owner.unmount();
  });

  it("a later user-driven refetch that fails is not surfaced as an error by a card that waited on an earlier request", async () => {
    const store = makeStore();
    await holdMeta();
    let resolveWaited!: (v: typeof OK) => void;
    rows.mockReturnValueOnce(new Promise((res) => (resolveWaited = res)));
    const owner = renderHook(() => usePanelData(panel), { wrapper: wrap(store) });
    const waiter = renderHook(() => usePanelData(panel), { wrapper: wrap(store) });
    await waitFor(() => expect(rows).toHaveBeenCalledTimes(1));
    rows.mockRejectedValueOnce(new Error("sort failed"));
    await act(async () => {
      await store.dispatch(
        fetchPanelPage({
          panelId: "p1",
          outputId: "o1",
          page: 0,
          pageSize: 200,
          sort: { column: "a", direction: "asc" },
        }),
      );
    });
    await act(async () => resolveWaited(OK));
    expect(waiter.result.current.error).toBeNull();
    owner.unmount();
  });

  it("a detail-modal style caller fetches its own query when the window was fetched under another", async () => {
    const store = makeStore();
    await holdMeta();
    await act(async () => {
      await store.dispatch(
        fetchPanelPage({
          panelId: "p1",
          outputId: "o1",
          page: 0,
          pageSize: 200,
          filter: { quick: "x" },
        }),
      );
    });
    renderHook(() => usePanelData(panel), { wrapper: wrap(store) });
    await waitFor(() => expect(rows).toHaveBeenCalledTimes(2));
    expect(rows.mock.calls[1][4]).toBeUndefined();
  });

  it("a mounted card whose bound Output changes fetches page 0 for the new Output", async () => {
    const store = makeStore();
    await holdMeta();
    const hook = renderHook(({ p }) => usePanelData(p), {
      wrapper: wrap(store),
      initialProps: { p: panel },
    });
    await waitFor(() => expect(hook.result.current.rawRows).not.toBeNull());
    hook.rerender({ p: makeOutputPanel({ id: "p1", config: { outputId: "o2" } }) });
    await waitFor(() => expect(rows).toHaveBeenCalledTimes(2));
    expect(rows.mock.calls[1][0]).toBe("o2");
  });

  it("keeps serving the window after a Load more", async () => {
    const store = makeStore();
    await holdMeta();
    await firstLoad(store);
    await act(async () => {
      await store.dispatch(
        fetchPanelPage({ panelId: "p1", outputId: "o1", page: 1, pageSize: 50 }),
      );
    });
    const calls = rows.mock.calls.length;
    renderHook(() => usePanelData(panel), { wrapper: wrap(store) });
    expect(rows).toHaveBeenCalledTimes(calls);
  });

  it("a StrictMode cold mount issues one rows request", async () => {
    const store = makeStore();
    const hook = renderHook(() => usePanelData(panel), { wrapper: wrap(store, true) });
    await waitFor(() => expect(hook.result.current.rawRows).not.toBeNull());
    expect(rows).toHaveBeenCalledTimes(1);
  });

  it("refresh() always fetches, even with a reusable window", async () => {
    const store = makeStore();
    await holdMeta();
    await firstLoad(store);
    const hook = renderHook(() => usePanelData(panel), { wrapper: wrap(store) });
    act(() => hook.result.current.refresh());
    await waitFor(() => expect(rows).toHaveBeenCalledTimes(2));
  });

  it("a card that unmounts while waiting on another request releases its store subscription", async () => {
    const store = makeStore();
    await holdMeta();
    let resolve!: (v: typeof OK) => void;
    rows.mockReturnValueOnce(new Promise((res) => (resolve = res)));
    const owner = renderHook(() => usePanelData(panel), { wrapper: wrap(store) });
    await waitFor(() => expect(rows).toHaveBeenCalledTimes(1));
    let active = 0;
    const subscribe = store.subscribe.bind(store);
    jest.spyOn(store, "subscribe").mockImplementation((listener) => {
      active += 1;
      const off = subscribe(listener);
      let released = false;
      return () => {
        if (!released) active -= 1;
        released = true;
        off();
      };
    });
    const before = active;
    const waiter = renderHook(() => usePanelData(panel), { wrapper: wrap(store) });
    expect(active).toBeGreaterThan(before);
    waiter.unmount();
    expect(active).toBe(before);
    await act(async () => resolve(OK));
    owner.unmount();
  });

  it.each([
    ["an Output write", () => invalidateOutput("o1")],
    ["a pipeline write or run", () => invalidatePipeline("pipeline-o1")],
  ])(
    "an invalidation (%s) landing while the request is in flight makes the next mount fetch exactly once",
    async (_name, invalidate) => {
      const store = makeStore();
      await holdMeta();
      let resolve!: (v: typeof OK) => void;
      rows.mockReturnValueOnce(new Promise((res) => (resolve = res)));
      const first = renderHook(() => usePanelData(panel), { wrapper: wrap(store) });
      await waitFor(() => expect(rows).toHaveBeenCalledTimes(1));
      invalidate();
      await act(async () => resolve(OK));
      await waitFor(() => expect(first.result.current.rawRows).not.toBeNull());
      first.unmount();
      renderHook(() => usePanelData(panel), { wrapper: wrap(store) });
      await waitFor(() => expect(rows).toHaveBeenCalledTimes(2));
      await act(async () => undefined);
      expect(rows).toHaveBeenCalledTimes(2);
    },
  );

  it("an ownership skip over an already-settled window leaves refresh() usable at once", async () => {
    const store = makeStore();
    await holdMeta();
    await firstLoad(store);
    const mountOwnership = { current: true };
    const hook = renderHook(() => usePanelData(panel, [], null, { mountOwnership }), {
      wrapper: wrap(store),
    });
    expect(rows).toHaveBeenCalledTimes(1);
    act(() => hook.result.current.refresh());
    await waitFor(() => expect(rows).toHaveBeenCalledTimes(2));
  });

  describe("mount ownership", () => {
    it("makes no mount request of its own, and a later refresh() still dispatches once the owned request failed", async () => {
      const store = makeStore();
      await holdMeta();
      let reject!: (e: Error) => void;
      rows.mockReturnValueOnce(new Promise((_, rej) => (reject = rej)));
      const owned = store.dispatch(
        fetchPanelPage({
          panelId: "p1",
          outputId: "o1",
          page: 0,
          pageSize: 200,
          sort: { column: "a", direction: "asc" },
        }),
      );
      const mountOwnership = { current: true };
      const hook = renderHook(() => usePanelData(panel, [], null, { mountOwnership }), {
        wrapper: wrap(store, true),
      });
      expect(rows).toHaveBeenCalledTimes(1);
      await act(async () => {
        reject(new Error("boom"));
        await owned;
      });
      await waitFor(() => expect(hook.result.current.error).toBe("Failed to load panel data."));
      rows.mockResolvedValue(OK);
      act(() => hook.result.current.refresh());
      await waitFor(() => expect(rows).toHaveBeenCalledTimes(2));
    });

    it("a refresh() that arrives while the owned request is pending dispatches nothing, then works after it settles", async () => {
      const store = makeStore();
      await holdMeta();
      let resolve!: (v: typeof OK) => void;
      rows.mockReturnValueOnce(new Promise((res) => (resolve = res)));
      const owned = store.dispatch(
        fetchPanelPage({
          panelId: "p1",
          outputId: "o1",
          page: 0,
          pageSize: 200,
          sort: { column: "a", direction: "asc" },
        }),
      );
      const mountOwnership = { current: true };
      const hook = renderHook(() => usePanelData(panel, [], null, { mountOwnership }), {
        wrapper: wrap(store),
      });
      act(() => hook.result.current.refresh());
      expect(rows).toHaveBeenCalledTimes(1);
      await act(async () => {
        resolve(OK);
        await owned;
      });
      act(() => hook.result.current.refresh());
      await waitFor(() => expect(rows).toHaveBeenCalledTimes(2));
    });
  });
});
