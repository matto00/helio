import { configureStore } from "@reduxjs/toolkit";
import { render } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { pipelinesReducer } from "../pipelines/state/pipelinesSlice";
import { sourcesReducer } from "../sources/state/sourcesSlice";
import { recentHistoryStore } from "./model/recentHistoryStore";
import { RecentVisitsRouteObserver } from "./RecentVisitsRouteObserver";

// Task 3.2 — the component writes to the module-singleton `recentHistoryStore` (it has no
// injection point; see design.md D2's non-unification rationale), so this test asserts against
// that singleton's own entries directly and cleans up afterward. It now also reads
// `state.sources`/`state.pipelines` (skeptic-final-1.md CR1's title persistence), so every
// render needs a real Redux `Provider`.

function buildStore(preloadedSources: { id: string; name: string }[] = []) {
  return configureStore({
    reducer: { sources: sourcesReducer, pipelines: pipelinesReducer },
    preloadedState: {
      sources: {
        items: preloadedSources as never,
        status: "idle" as const,
        error: null,
        errorKind: null,
        selectedSourceId: null,
        addModalOpen: false,
      },
    },
  });
}

describe("RecentVisitsRouteObserver — task 3.2", () => {
  afterEach(() => {
    for (const entry of recentHistoryStore.getEntries()) {
      recentHistoryStore.pruneMissing(entry.kind, new Set());
    }
  });

  it("records a visit on arrival at /sources/:id", () => {
    render(
      <Provider store={buildStore()}>
        <MemoryRouter initialEntries={["/sources/abc"]}>
          <RecentVisitsRouteObserver />
        </MemoryRouter>
      </Provider>,
    );
    expect(recentHistoryStore.getEntries()).toEqual([
      expect.objectContaining({ kind: "source", id: "abc" }),
    ]);
  });

  it("records a visit on arrival at /pipelines/:id", () => {
    render(
      <Provider store={buildStore()}>
        <MemoryRouter initialEntries={["/pipelines/xyz"]}>
          <RecentVisitsRouteObserver />
        </MemoryRouter>
      </Provider>,
    );
    expect(recentHistoryStore.getEntries()).toEqual([
      expect.objectContaining({ kind: "pipeline", id: "xyz" }),
    ]);
  });

  it("records nothing on an unrelated route", () => {
    render(
      <Provider store={buildStore()}>
        <MemoryRouter initialEntries={["/settings"]}>
          <RecentVisitsRouteObserver />
        </MemoryRouter>
      </Provider>,
    );
    expect(recentHistoryStore.getEntries()).toEqual([]);
  });

  // skeptic-final-1.md CR1 — the whole fix: when the title is ALREADY resolvable in Redux at
  // the moment of arrival, it must be persisted onto the entry immediately (not left to a later
  // fetch), so the palette can render this row on `/`, which never fetches `sources` at all.
  it("persists the title when it's already resolvable in Redux", () => {
    render(
      <Provider store={buildStore([{ id: "abc", name: "My Source" }])}>
        <MemoryRouter initialEntries={["/sources/abc"]}>
          <RecentVisitsRouteObserver />
        </MemoryRouter>
      </Provider>,
    );
    expect(recentHistoryStore.getEntries()[0]).toMatchObject({ id: "abc", title: "My Source" });
  });

  // Self-heal within the SAME visit: the title isn't resolvable yet at mount (a first-ever
  // visit, detail page's own fetch still in flight), then becomes resolvable — the entry must
  // be re-recorded with the now-known title, not left titleless forever.
  it("backfills the title once it becomes resolvable after mount", () => {
    const store = buildStore([]);
    const { rerender } = render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/sources/abc"]}>
          <RecentVisitsRouteObserver />
        </MemoryRouter>
      </Provider>,
    );
    expect(recentHistoryStore.getEntries()[0].title).toBeUndefined();

    const laterStore = buildStore([{ id: "abc", name: "Loaded Late" }]);
    rerender(
      <Provider store={laterStore}>
        <MemoryRouter initialEntries={["/sources/abc"]}>
          <RecentVisitsRouteObserver />
        </MemoryRouter>
      </Provider>,
    );
    expect(recentHistoryStore.getEntries()).toHaveLength(1);
    expect(recentHistoryStore.getEntries()[0]).toMatchObject({ id: "abc", title: "Loaded Late" });
  });
});
