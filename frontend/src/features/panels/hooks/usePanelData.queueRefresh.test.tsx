import { configureStoreOwning } from "../../../test/configureOwnedStore";
import { act, renderHook, waitFor } from "@testing-library/react";
import { AxiosError, type AxiosResponse } from "axios";
import type { PropsWithChildren } from "react";
import { createElement } from "react";
import { Provider } from "react-redux";

import { fetchPanelPage, panelsReducer } from "../state/panelsSlice";
import { resetCapabilitiesStoreForTests } from "../state/filterCapabilitiesStore";
import * as outputService from "../../pipelines/services/outputService";
import { makeOutputPanel, makeTextPanel } from "../../../test/panelFixtures";
import type { Panel, SelectionDescriptor } from "../types/panel";
import { usePanelData } from "./usePanelData";

// HEL-1738 design D2: every site where the in-flight guard falls and a queued refresh must be sent or dropped.
// Each test names the mutation it kills (recorded in red-first-evidence.md).

// HEL-1780 D1: the dashboards this file's panels belong to are held as owned by the caller (explicitly, per file).
const configureStore = configureStoreOwning("dash-1", "dashboard-1");

jest.mock("../../pipelines/services/outputService", () => ({
  ...jest.requireActual("../../pipelines/services/outputService"),
  getOutputRows: jest.fn(),
}));

const rows = jest.mocked(outputService.getOutputRows);
type Page = Awaited<ReturnType<typeof outputService.getOutputRows>>;
const page = (n: number): Page => ({
  items: [{ n }],
  total: 1,
  offset: 0,
  limit: 200,
  materialized: true,
});

/** A request held open by hand, per call, so each test controls exactly when each one settles. */
function holdRows() {
  const held: Array<{
    outputId: string;
    resolve: (p: Page) => void;
    reject: (e: unknown) => void;
  }> = [];
  rows.mockImplementation(
    (outputId) =>
      new Promise<Page>((resolve, reject) => {
        held.push({ outputId, resolve, reject });
      }),
  );
  return held;
}

function makeStore(extra: Record<string, unknown> = {}) {
  return configureStore({
    reducer: { panels: panelsReducer } as never,
    preloadedState: {
      panels: { ...panelsReducer(undefined, { type: "@@INIT" }), ...extra },
    } as never,
  });
}
type Store = ReturnType<typeof makeStore>;

const wrap = (store: Store) =>
  function Wrapper({ children }: PropsWithChildren) {
    return createElement(Provider, { store } as never, children);
  };

const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

const out = (outputId: string) => makeOutputPanel({ id: "p1", config: { outputId } });

beforeEach(() => {
  jest.clearAllMocks();
  resetCapabilitiesStoreForTests();
});

describe("usePanelData queueRefresh drain and drop sites (HEL-1738 D2)", () => {
  // kills M2: remove drain() at the subscribeWait store-listener settle
  it("a refresh queued while the hook waits on a request someone else owns is sent once it settles, with no false isRefreshing between", async () => {
    const held = holdRows();
    const store = makeStore({ items: [out("out-1")] });
    const owned = store.dispatch(
      fetchPanelPage({
        panelId: "p1",
        dashboardId: "dash-1",
        outputId: "out-1",
        page: 0,
        pageSize: 200,
        sort: { column: "a", direction: "asc" },
      }),
    );
    expect(held).toHaveLength(1);
    const seen: boolean[] = [];
    const mountOwnership = { current: true };
    const panel = out("out-1");
    const { result } = renderHook(
      () => {
        const r = usePanelData(panel, [], null, { mountOwnership });
        seen.push(r.isRefreshing);
        return r;
      },
      { wrapper: wrap(store) },
    );
    expect(held).toHaveLength(1); // the owner holds the mount's request; this hook sent none
    const from = seen.length;
    act(() => result.current.queueRefresh());
    act(() => result.current.queueRefresh());
    expect(held).toHaveLength(1);

    await act(async () => {
      held[0].resolve(page(1));
      await owned;
    });
    await waitFor(() => expect(held).toHaveLength(2));
    expect(result.current.isRefreshing).toBe(true);
    await act(async () => {
      held[1].resolve(page(2));
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.isRefreshing).toBe(false));
    await flush();
    expect(held).toHaveLength(2);
    expect(seen.slice(from, seen.lastIndexOf(true) + 1).every(Boolean)).toBe(true);
  });

  // kills M9: remove dropQueued() in the no-key branch
  it("a queue dropped by losing the Output binding is not sent once the panel binds to another Output", async () => {
    const held = holdRows();
    let panel: Panel = out("out-1");
    const store = makeStore({ items: [panel] });
    const { result, rerender } = renderHook(() => usePanelData(panel), { wrapper: wrap(store) });
    await waitFor(() => expect(held).toHaveLength(1));
    act(() => result.current.queueRefresh());
    expect(result.current.isRefreshing).toBe(true);

    panel = makeTextPanel({ id: "p1" });
    rerender();
    panel = out("out-2");
    rerender();
    await waitFor(() => expect(held).toHaveLength(2));
    expect(held[1].outputId).toBe("out-2");

    await act(async () => {
      held[0].resolve(page(1));
      held[1].resolve(page(2));
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.isRefreshing).toBe(false));
    await flush();
    // out-2 got exactly its own request: the queue made before the rebind did not follow it.
    expect(held).toHaveLength(2);
  });

  // kills M4: drop the latestFetchRequestId comparison before drain in .finally
  it("a stale request settling does not send the queued refresh over a newer pending request", async () => {
    const held = holdRows();
    let panel: Panel = out("out-1");
    const store = makeStore({ items: [panel] });
    const { result, rerender } = renderHook(() => usePanelData(panel), { wrapper: wrap(store) });
    await waitFor(() => expect(held).toHaveLength(1));
    act(() => result.current.queueRefresh());

    panel = out("out-2");
    rerender();
    await waitFor(() => expect(held).toHaveLength(2));

    // out-1 settles first, while out-2 is still pending: nothing may be sent on top of out-2.
    await act(async () => {
      held[0].resolve(page(1));
      await Promise.resolve();
    });
    await flush();
    expect(held).toHaveLength(2);

    // out-2 settling sends the queued refresh, once.
    await act(async () => {
      held[1].resolve(page(2));
      await Promise.resolve();
    });
    await waitFor(() => expect(held).toHaveLength(3));
    await act(async () => {
      held[2].resolve(page(3));
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.isRefreshing).toBe(false));
    await flush();
    expect(held).toHaveLength(3);
  });

  // kills M5: `return;` instead of `return retry;` in the CROSS_FILTER_EQ_REJECTED branch
  it("a refresh queued behind a cross-filter-rejected request waits for the retry, never overlapping it", async () => {
    const held = holdRows();
    const cross: SelectionDescriptor = {
      panelId: "origin",
      dimension: "quarter",
      value: "Q1",
      series: "",
    };
    const panel = out("out-1");
    const store = makeStore({
      items: [panel],
      crossFilter: cross,
      paginationState: {
        p1: {
          currentPage: 0,
          hasMore: false,
          isLoadingMore: false,
          rows: [{ quarter: "Q1" }],
          materialized: true,
          total: 1,
          lastQuery: { outputId: "out-1", crossFilterEq: { column: "quarter", value: "Q1" } },
        },
      },
    });
    const { result } = renderHook(() => usePanelData(panel), { wrapper: wrap(store) });
    await waitFor(() => expect(held).toHaveLength(1));
    expect(rows.mock.calls[0][4]).toEqual({ ops: [{ column: "quarter", op: "eq", value: "Q1" }] });
    act(() => result.current.queueRefresh());

    // The first request is rejected for its eq: the hook retries without it.
    await act(async () => {
      held[0].reject(
        new AxiosError("Bad Request", "ERR_BAD_REQUEST", undefined, undefined, {
          status: 400,
          data: {},
        } as AxiosResponse),
      );
      await Promise.resolve();
    });
    await waitFor(() => expect(held).toHaveLength(2));
    expect(rows.mock.calls[1][4]).toBeUndefined();
    await flush();
    // Still only the retry in flight: the queued refresh waits for it.
    expect(held).toHaveLength(2);
    expect(result.current.isRefreshing).toBe(true);

    await act(async () => {
      held[1].resolve(page(1));
      await Promise.resolve();
    });
    await waitFor(() => expect(held).toHaveLength(3));
    await act(async () => {
      held[2].resolve(page(2));
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.isRefreshing).toBe(false));
    await flush();
    expect(held).toHaveLength(3);
  });

  // kills M10: drop the hand-off to a request this hook did not send (the queue strands, isRefreshing sticks)
  describe("a request this hook did not send supersedes the one the queue waits on", () => {
    const sortPage = (): Parameters<typeof fetchPanelPage>[0] => ({
      panelId: "p1",
      dashboardId: "dash-1",
      outputId: "out-1",
      page: 0,
      pageSize: 200,
      sort: { column: "n", direction: "asc" },
    });
    const loadMorePage = (): Parameters<typeof fetchPanelPage>[0] => ({
      panelId: "p1",
      dashboardId: "dash-1",
      outputId: "out-1",
      page: 1,
      pageSize: 200,
    });

    async function scenario(foreign: (store: Store, hook2: () => void) => unknown) {
      const held = holdRows();
      const panel = out("out-1");
      const store = makeStore({ items: [panel] });
      const { result } = renderHook(() => usePanelData(panel), { wrapper: wrap(store) });
      await waitFor(() => expect(held).toHaveLength(1));
      await act(async () => {
        held[0].resolve(page(0));
        await Promise.resolve();
      });
      await waitFor(() => expect(result.current.isRefreshing).toBe(false));
      await flush();
      // A poll/SSE refresh is in flight, the round queues behind it, then someone else dispatches for the panel.
      act(() => result.current.refresh());
      await waitFor(() => expect(held).toHaveLength(2));
      act(() => result.current.queueRefresh());
      let foreignRequest: unknown;
      act(() => {
        foreignRequest = foreign(store, () => undefined);
      });
      expect(held).toHaveLength(3);
      // Our request settles first: nothing may be sent over the foreign one still pending.
      await act(async () => {
        held[1].resolve(page(1));
        await Promise.resolve();
      });
      await flush();
      expect(held).toHaveLength(3);
      expect(result.current.isRefreshing).toBe(true);
      await act(async () => {
        held[2].resolve(page(2));
        await Promise.resolve();
        await foreignRequest;
      });
      // Exactly one queued refresh follows.
      await waitFor(() => expect(held).toHaveLength(4));
      await act(async () => {
        held[3].resolve(page(3));
        await Promise.resolve();
      });
      await waitFor(() => expect(result.current.isRefreshing).toBe(false));
      await flush();
      expect(held).toHaveLength(4);
      // A stale queue cannot carry into the next dispatch: one press sends exactly one request.
      act(() => result.current.queueRefresh());
      await waitFor(() => expect(held).toHaveLength(5));
      await act(async () => {
        held[4].resolve(page(4));
        await Promise.resolve();
      });
      await waitFor(() => expect(result.current.isRefreshing).toBe(false));
      await flush();
      expect(held).toHaveLength(5);
    }

    it("a sort/filter refetch for the same panel", async () => {
      await scenario((store) => store.dispatch(fetchPanelPage(sortPage())));
    });

    it("a load-more page for the same panel", async () => {
      await scenario((store) => store.dispatch(fetchPanelPage(loadMorePage())));
    });

    it("a second usePanelData instance on the same panel with its own filter (the detail modal)", async () => {
      await scenario((store) => {
        renderHook(
          () => usePanelData(out("out-1"), [{ column: "n", op: "eq", value: 1 } as never]),
          { wrapper: wrap(store) },
        );
        return undefined;
      });
    });
  });
});
