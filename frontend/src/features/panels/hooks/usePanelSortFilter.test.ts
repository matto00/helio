// HEL-1027 design.md D4/D10 (tasks 4.1/4.3/4.6) — `usePanelSortFilter` owns the authoritative
// sort/filter state driving a table panel's server-side round trip. See the hook's own doc
// comment for the full contract.

import { configureStore } from "@reduxjs/toolkit";
import { act, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { createElement } from "react";
import { Provider } from "react-redux";

import { fetchPanelPage, panelsReducer } from "../state/panelsSlice";
import { toastsReducer } from "../../toasts/state/toastsSlice";
import * as outputService from "../../pipelines/services/outputService";
import type { Output } from "../../pipelines/types/output";
import { usePanelSortFilter } from "./usePanelSortFilter";

// HEL-1190 — `composeOutputRowsFilter`/`isFilterActive` are pure logic this hook now calls
// unconditionally (even with the default `controlFilterOps = []`); preserved as REAL
// implementations via `requireActual` so every pre-existing assertion on `getOutputRows`'s exact
// `filter` argument stays correct — only `getOutputRows` itself is mocked, unchanged from before.
jest.mock("../../pipelines/services/outputService", () => ({
  ...jest.requireActual("../../pipelines/services/outputService"),
  getOutputRows: jest.fn(),
}));

const mockGetOutputRows = outputService.getOutputRows as jest.MockedFunction<
  typeof outputService.getOutputRows
>;

function makeOutput(overrides: Partial<Output> = {}): Output {
  return {
    id: "output-1",
    pipelineId: "pipeline-1",
    ownerId: "u1",
    name: "Out",
    kind: "table",
    config: {},
    schema: [],
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

function makeStore() {
  return configureStore({
    reducer: { panels: panelsReducer, toasts: toastsReducer } as never,
  });
}

function wrapper(store: ReturnType<typeof makeStore>) {
  return function Wrapper({ children }: PropsWithChildren) {
    return createElement(Provider, { store } as never, children);
  };
}

describe("usePanelSortFilter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("task 4.1: seeds filterActive true once output resolves with a persisted columnFilters", () => {
    const store = makeStore();
    const output = makeOutput({ config: { columnFilters: { quick: "x" } } });
    const { result } = renderHook(() => usePanelSortFilter("panel-1", "output-1", output), {
      wrapper: wrapper(store),
    });
    expect(result.current.filterActive).toBe(true);
  });

  it("filterActive is false with no persisted filter, and false while output is still null", () => {
    const store = makeStore();
    const { result: whileLoading } = renderHook(
      () => usePanelSortFilter("panel-1", "output-1", null),
      { wrapper: wrapper(store) },
    );
    expect(whileLoading.current.filterActive).toBe(false);

    const { result: noFilter } = renderHook(
      () => usePanelSortFilter("panel-1", "output-1", makeOutput()),
      { wrapper: wrapper(store) },
    );
    expect(noFilter.current.filterActive).toBe(false);
  });

  it("task 4.3: handleSortChange debounces, then dispatches a page-0 fetch carrying the new sort, replacing (not appending to) previously-loaded rows", async () => {
    jest.useFakeTimers();
    mockGetOutputRows.mockResolvedValue({
      items: [{ revenue: 99 }],
      total: 1,
      offset: 0,
      limit: 200,
      materialized: true,
    });
    const store = makeStore();
    // Seed existing pagination as if "Load more" had already run to page 1.
    store.dispatch(
      fetchPanelPage.pending("req-seed", {
        panelId: "panel-1",
        outputId: "output-1",
        page: 1,
        pageSize: 50,
      }),
    );
    store.dispatch(
      fetchPanelPage.fulfilled(
        {
          panelId: "panel-1",
          page: 1,
          rows: [{ revenue: 1 }, { revenue: 2 }],
          hasMore: false,
          materialized: true,
          total: 2,
        },
        "req-seed",
        { panelId: "panel-1", outputId: "output-1", page: 1, pageSize: 50 },
      ),
    );
    expect(store.getState().panels.paginationState["panel-1"].currentPage).toBe(1);

    const { result } = renderHook(() => usePanelSortFilter("panel-1", "output-1", null), {
      wrapper: wrapper(store),
    });

    act(() => {
      result.current.handleSortChange("revenue", "desc");
    });
    // HEL-1027 skeptic-final-1.md CR1 — the refetch is debounced; no dispatch yet.
    expect(mockGetOutputRows).not.toHaveBeenCalled();
    // The OLD rows stay visible/mounted through the debounce+in-flight window (Defect 1 fix) --
    // never reset to empty synchronously.
    expect(store.getState().panels.paginationState["panel-1"].rows).toEqual([
      { revenue: 1 },
      { revenue: 2 },
    ]);

    await act(async () => {
      jest.advanceTimersByTime(300);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockGetOutputRows).toHaveBeenCalledWith(
      "output-1",
      0,
      200,
      { column: "revenue", direction: "desc" },
      undefined,
    );
    const entry = store.getState().panels.paginationState["panel-1"];
    expect(entry.currentPage).toBe(0);
    // No duplicated/dropped rows: page-1's rows are gone, replaced by the new page-0 response,
    // not appended to it.
    expect(entry.rows).toEqual([{ revenue: 99 }]);
    jest.useRealTimers();
  });

  it("task 4.3: handleFilterChange carries the currently-active sort alongside the new filter", async () => {
    jest.useFakeTimers();
    mockGetOutputRows.mockResolvedValue({
      items: [],
      total: 0,
      offset: 0,
      limit: 200,
      materialized: true,
    });
    const store = makeStore();
    const { result } = renderHook(() => usePanelSortFilter("panel-1", "output-1", null), {
      wrapper: wrapper(store),
    });

    act(() => {
      result.current.handleSortChange("revenue", "asc");
    });
    await act(async () => {
      jest.advanceTimersByTime(300);
      await Promise.resolve();
      await Promise.resolve();
    });
    mockGetOutputRows.mockClear();

    act(() => {
      result.current.handleFilterChange({ quick: "acme" });
    });
    await act(async () => {
      jest.advanceTimersByTime(300);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockGetOutputRows).toHaveBeenCalledWith(
      "output-1",
      0,
      200,
      { column: "revenue", direction: "asc" },
      { quick: "acme" },
    );
    jest.useRealTimers();
  });

  it("HEL-1027 skeptic-final-1.md CR1 — rapid successive keystrokes coalesce into ONE debounced refetch carrying the FULL final term, not one request per keystroke", async () => {
    jest.useFakeTimers();
    mockGetOutputRows.mockResolvedValue({
      items: [],
      total: 0,
      offset: 0,
      limit: 200,
      materialized: true,
    });
    const store = makeStore();
    const { result } = renderHook(() => usePanelSortFilter("panel-1", "output-1", null), {
      wrapper: wrapper(store),
    });

    // Simulates typing "target" one character at a time, each keystroke well inside the
    // debounce window of the previous one (mirrors a real per-keystroke onChange stream).
    for (const partial of ["t", "ta", "tar", "targ", "targe", "target"]) {
      act(() => {
        result.current.handleFilterChange({ quick: partial });
      });
      act(() => {
        jest.advanceTimersByTime(50);
      });
    }
    // Still nothing dispatched — every keystroke re-armed the debounce timer.
    expect(mockGetOutputRows).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(300);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Exactly ONE request, carrying the FULL final term.
    expect(mockGetOutputRows).toHaveBeenCalledTimes(1);
    expect(mockGetOutputRows).toHaveBeenCalledWith("output-1", 0, 200, undefined, {
      quick: "target",
    });
    jest.useRealTimers();
  });

  it("task 7.3 live-UI finding: a genuinely active PERSISTED default (sort or filter) triggers an immediate server-side refetch, not just usePanelData's own unsorted/unfiltered initial fetch", async () => {
    mockGetOutputRows.mockResolvedValue({
      items: [{ label: "target" }],
      total: 1,
      offset: 0,
      limit: 200,
      materialized: true,
    });
    const store = makeStore();
    const output = makeOutput({ config: { columnFilters: { quick: "target" } } });
    renderHook(() => usePanelSortFilter("panel-1", "output-1", output), {
      wrapper: wrapper(store),
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockGetOutputRows).toHaveBeenCalledWith("output-1", 0, 200, undefined, {
      quick: "target",
    });
  });

  it("no refetch happens when the persisted default has neither an active sort nor an active filter", async () => {
    const store = makeStore();
    renderHook(() => usePanelSortFilter("panel-1", "output-1", makeOutput()), {
      wrapper: wrapper(store),
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockGetOutputRows).not.toHaveBeenCalled();
  });

  it("task 4.6: a rejected refetch (defense-in-depth 400) pushes a visible, non-silent error toast", async () => {
    jest.useFakeTimers();
    mockGetOutputRows.mockRejectedValue(
      Object.assign(new Error("Request failed with status code 400"), {
        isAxiosError: true,
        response: { status: 400, data: { message: "column not sortable: 'bogus'" } },
      }),
    );
    const store = makeStore();
    const { result } = renderHook(() => usePanelSortFilter("panel-1", "output-1", null), {
      wrapper: wrapper(store),
    });

    act(() => {
      result.current.handleSortChange("bogus", "asc");
    });
    await act(async () => {
      jest.advanceTimersByTime(300);
      await Promise.resolve();
      await Promise.resolve();
    });

    const toasts = store.getState().toasts.items;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({
      variant: "error",
      message: "column not sortable: 'bogus'",
    });
    jest.useRealTimers();
  });

  // HEL-1190 design.md D3 (task 4.3) — the viewer-control composition this hook now performs.
  describe("controlFilterOps composition (HEL-1190 design.md D3, task 4.3)", () => {
    it("a control selection present at mount triggers the SAME one-time corrective fetch as a persisted in-panel default, carrying it as ops[]", async () => {
      mockGetOutputRows.mockResolvedValue({
        items: [],
        total: 0,
        offset: 0,
        limit: 200,
        materialized: true,
      });
      const store = makeStore();
      renderHook(
        () =>
          usePanelSortFilter("panel-1", "output-1", makeOutput(), [
            { column: "region", op: "eq", value: "east" },
          ]),
        { wrapper: wrapper(store) },
      );

      await act(async () => {
        await Promise.resolve();
      });

      expect(mockGetOutputRows).toHaveBeenCalledWith("output-1", 0, 200, undefined, {
        ops: [{ column: "region", op: "eq", value: "east" }],
      });
    });

    it("ANDs an active control selection with an active in-panel filter as separate ops[]/columns entries on the SAME request", async () => {
      jest.useFakeTimers();
      mockGetOutputRows.mockResolvedValue({
        items: [],
        total: 0,
        offset: 0,
        limit: 200,
        materialized: true,
      });
      const store = makeStore();
      const { result } = renderHook(
        () =>
          usePanelSortFilter("panel-1", "output-1", null, [
            { column: "region", op: "eq", value: "east" },
          ]),
        { wrapper: wrapper(store) },
      );

      act(() => {
        result.current.handleFilterChange({ quick: "acme" });
      });
      await act(async () => {
        jest.advanceTimersByTime(300);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(mockGetOutputRows).toHaveBeenCalledWith("output-1", 0, 200, undefined, {
        quick: "acme",
        ops: [{ column: "region", op: "eq", value: "east" }],
      });
      jest.useRealTimers();
    });

    it("a control change AFTER mount (not just at mount) independently re-triggers the combined-filter fetch, resetting to page 0", async () => {
      mockGetOutputRows.mockResolvedValue({
        items: [],
        total: 0,
        offset: 0,
        limit: 200,
        materialized: true,
      });
      const store = makeStore();
      // Seed pagination at page 1, mirroring the existing "Load more already ran" precedent.
      store.dispatch(
        fetchPanelPage.pending("req-seed", {
          panelId: "panel-1",
          outputId: "output-1",
          page: 1,
          pageSize: 50,
        }),
      );
      store.dispatch(
        fetchPanelPage.fulfilled(
          {
            panelId: "panel-1",
            page: 1,
            rows: [{ a: 1 }],
            hasMore: false,
            materialized: true,
            total: 1,
          },
          "req-seed",
          { panelId: "panel-1", outputId: "output-1", page: 1, pageSize: 50 },
        ),
      );

      const output = makeOutput();
      type Ops = NonNullable<Parameters<typeof usePanelSortFilter>[3]>;
      const { rerender } = renderHook(
        ({ ops }: { ops: Ops }) => usePanelSortFilter("panel-1", "output-1", output, ops),
        { wrapper: wrapper(store), initialProps: { ops: [] as Ops } },
      );

      await act(async () => {
        await Promise.resolve();
      });
      mockGetOutputRows.mockClear();

      rerender({ ops: [{ column: "region", op: "eq", value: "west" }] });

      await act(async () => {
        await Promise.resolve();
      });

      expect(mockGetOutputRows).toHaveBeenCalledWith("output-1", 0, 200, undefined, {
        ops: [{ column: "region", op: "eq", value: "west" }],
      });
      expect(store.getState().panels.paginationState["panel-1"].currentPage).toBe(0);
    });
  });
});

// HEL-1191 design.md D9a-ii, C4 — `crossFilterEq` is its own input: never concatenated into
// `controlFilterOps`, but joining the corrective-mount condition and the change key.
describe("usePanelSortFilter — crossFilterEq (HEL-1191 D9a-ii)", () => {
  const EQ = { column: "quarter", value: "Q1" };
  const emptyPage = { items: [], total: 0, offset: 0, limit: 200, materialized: true };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetOutputRows.mockResolvedValue(emptyPage);
  });

  it("an eq present at mount triggers the one-time corrective fetch, carrying it as a separate ops entry", async () => {
    const store = makeStore();
    renderHook(() => usePanelSortFilter("panel-1", "output-1", makeOutput(), [], EQ), {
      wrapper: wrapper(store),
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockGetOutputRows).toHaveBeenCalledWith("output-1", 0, 200, undefined, {
      ops: [{ column: "quarter", op: "eq", value: "Q1" }],
    });
    expect(store.getState().panels.paginationState["panel-1"].lastQuery).toMatchObject({
      crossFilterEq: EQ,
    });
  });

  it("set, change and clear each re-dispatch page 0 (clear drops the eq)", async () => {
    const store = makeStore();
    type Eq = typeof EQ | null;
    const output = makeOutput();
    const { rerender } = renderHook(
      ({ eq }: { eq: Eq }) => usePanelSortFilter("panel-1", "output-1", output, [], eq),
      { wrapper: wrapper(store), initialProps: { eq: null as Eq } },
    );
    await act(async () => {
      await Promise.resolve();
    });
    mockGetOutputRows.mockClear();

    rerender({ eq: EQ });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockGetOutputRows).toHaveBeenLastCalledWith("output-1", 0, 200, undefined, {
      ops: [{ column: "quarter", op: "eq", value: "Q1" }],
    });

    rerender({ eq: { column: "quarter", value: "Q2" } });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockGetOutputRows).toHaveBeenLastCalledWith("output-1", 0, 200, undefined, {
      ops: [{ column: "quarter", op: "eq", value: "Q2" }],
    });

    rerender({ eq: null });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockGetOutputRows).toHaveBeenLastCalledWith("output-1", 0, 200, undefined, undefined);
    expect(mockGetOutputRows).toHaveBeenCalledTimes(3);
  });

  it("an eq is ANDed with a same-column control op on the SAME request (no override)", async () => {
    const store = makeStore();
    renderHook(
      () =>
        usePanelSortFilter(
          "panel-1",
          "output-1",
          makeOutput(),
          [{ column: "quarter", op: "eq", value: "Q2" }],
          EQ,
        ),
      { wrapper: wrapper(store) },
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockGetOutputRows.mock.calls[0][4]?.ops).toEqual([
      { column: "quarter", op: "eq", value: "Q2" },
      { column: "quarter", op: "eq", value: "Q1" },
    ]);
  });
});
