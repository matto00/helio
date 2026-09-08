import { configureStore } from "@reduxjs/toolkit";
import { act, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { dashboardsReducer } from "../dashboards/state/dashboardsSlice";
import { outputsReducer } from "../pipelines/state/outputsSlice";
import { pipelinesReducer } from "../pipelines/state/pipelinesSlice";
import { sourcesReducer } from "../sources/state/sourcesSlice";
import { CommandPaletteProvider } from "./CommandPaletteProvider";
import { useSetCommandQuery } from "./hooks";
import { useResourceSearchActions } from "./useResourceSearchActions";

function buildStore() {
  return configureStore({
    reducer: {
      dashboards: dashboardsReducer,
      sources: sourcesReducer,
      pipelines: pipelinesReducer,
      outputs: outputsReducer,
    },
    preloadedState: {
      sources: {
        items: [
          { id: "s-apple", name: "Apple Source" } as never,
          { id: "s-banana", name: "Banana Source" } as never,
        ],
        status: "succeeded" as const,
        error: null,
        errorKind: null,
        selectedSourceId: null,
        addModalOpen: false,
      },
    },
  });
}

function Harness() {
  const setQuery = useSetCommandQuery();
  const { actions } = useResourceSearchActions();
  return (
    <div>
      <button onClick={() => setQuery("apple")}>type-apple</button>
      <button onClick={() => setQuery("banana")}>type-banana</button>
      <ul>
        {actions
          .filter((a) => !a.id.endsWith(".overflow"))
          .map((a) => (
            <li key={a.id}>{a.title}</li>
          ))}
      </ul>
    </div>
  );
}

function renderHarness() {
  const store = buildStore();
  render(
    <Provider store={store}>
      <MemoryRouter>
        <CommandPaletteProvider>
          <Harness />
        </CommandPaletteProvider>
      </MemoryRouter>
    </Provider>,
  );
}

// task 3.5 — FAILABLE BY MUTATION, RUN AND CONFIRMED: replacing `useResourceSearchActions.ts`'s
// `useDebouncedValue(query, DEBOUNCE_MS)` with the raw `query` turned the first test below RED
// ("Apple Source" appeared immediately, with no debounce window elapsed at all); restoring the
// debounce turned it back green. Both runs observed directly.
describe("useResourceSearchActions — debounced matching (HEL-503 design.md D6, task 3.5)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("does not compute a match immediately — the input is never blocked, but matching lags", () => {
    renderHarness();
    act(() => screen.getByText("type-apple").click());
    // Before the debounce window elapses, no search result has appeared yet.
    expect(screen.queryByText("Apple Source")).not.toBeInTheDocument();
  });

  it("typing two queries in quick succession resolves to the SECOND, never the first", () => {
    renderHarness();
    act(() => screen.getByText("type-apple").click());
    act(() => {
      jest.advanceTimersByTime(50); // well under the debounce window
    });
    act(() => screen.getByText("type-banana").click());
    act(() => {
      jest.advanceTimersByTime(200); // now past the (restarted) debounce window
    });

    expect(screen.queryByText("Apple Source")).not.toBeInTheDocument();
    expect(screen.getByText("Banana Source")).toBeInTheDocument();
  });

  it("eventually resolves the match once the debounce window elapses", () => {
    renderHarness();
    act(() => screen.getByText("type-apple").click());
    act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(screen.getByText("Apple Source")).toBeInTheDocument();
  });
});
