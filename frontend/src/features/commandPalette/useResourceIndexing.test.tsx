import { configureStore } from "@reduxjs/toolkit";
import { act, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";

import { httpClient } from "../../services/httpClient";
import { dashboardsReducer } from "../dashboards/state/dashboardsSlice";
import { outputsReducer } from "../pipelines/state/outputsSlice";
import { pipelinesReducer } from "../pipelines/state/pipelinesSlice";
import { sourcesReducer } from "../sources/state/sourcesSlice";
import { CommandPaletteProvider } from "./CommandPaletteProvider";
import { useCommandPalette } from "./hooks";
import { useResourceIndexing } from "./useResourceIndexing";

// Evaluator S1 (cycle 2) — mocking the SLICE thunks (the original version of this file) could
// not distinguish the fix from the bug it was written for: with slice-level mocks, nothing ever
// actually re-settles `failed` after the harness's `open` click resolves, so the retry-loop
// mutation (`statuses` back in the effect's dependency array) left every assertion here GREEN.
// Mocking `httpClient` at the bottom layer instead means the REAL thunks run, genuinely
// transition idle -> loading -> failed, and genuinely re-render — which is the only way a test
// can observe whether a re-render after settlement triggers an EXTRA dispatch.
jest.mock("../../services/httpClient", () => ({
  httpClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const mockedGet = jest.mocked(httpClient.get);

/** Resolves each of the four endpoints with the SHAPE its own service module actually expects
 * (`/api/pipelines` is a bare array; the other three are `{items: [...]}` paged shapes) — using
 * one generic `{data: {items: []}}` for every URL silently broke `getPipelines()`'s `.map()` in
 * an earlier version of this file, turning `fetchPipelines` into an unintended REJECTION on every
 * "successful" run and corrupting the very call-count assertions this file exists to make. */
function mockSuccessResponses(): void {
  mockedGet.mockImplementation((url: string) => {
    if (url === "/api/pipelines") {
      return Promise.resolve({ data: [] });
    }
    return Promise.resolve({ data: { items: [], total: 0, offset: 0, limit: 200 } });
  });
}

/**
 * Evaluator S1' (cycle 3) — a SELF-LIMITING rejecting mock, not an unbounded one. An unbounded
 * `mockRejectedValue` fed a genuine retry-loop regression (`statuses.*` reintroduced into
 * `useResourceIndexing.ts`'s effect deps) an endless supply of freshly-rejecting promises, each
 * one settling into a fresh `.rejected` action, each one a fresh reason for React's `act()` to
 * keep re-flushing — a tight microtask cascade with no macrotask boundary that starved the event
 * loop entirely (the evaluator observed >150s with no termination; `--testTimeout` never fires
 * because it can't preempt a starved microtask queue). That is a REAL defect turning into a
 * hanging test — indistinguishable from a CI infrastructure problem, which is worse than a
 * failing assertion: nobody would suspect the regression.
 *
 * Capping the mock at `cap` rejections and answering every call PAST that with a promise that
 * never settles breaks the cascade at a bounded size: `act()`'s flush loop runs out of new
 * work (a pending promise triggers nothing further) and returns in real time, and the following
 * `toHaveBeenCalledTimes(4)` assertion then fails FAST, BY NAME, with a concrete number (e.g.
 * "Expected: 4, Received: 41") instead of a timeout with no diagnostic content.
 */
function mockRejectingWithCap(cap: number): void {
  let calls = 0;
  mockedGet.mockImplementation(() => {
    calls += 1;
    if (calls > cap) {
      // Never settles — starves nothing further from this call, capping the cascade's size
      // instead of letting it run unbounded.
      return new Promise(() => {});
    }
    return Promise.reject(new Error("boom"));
  });
}

function buildStore() {
  return configureStore({
    reducer: {
      dashboards: dashboardsReducer,
      sources: sourcesReducer,
      pipelines: pipelinesReducer,
      outputs: outputsReducer,
    },
  });
}

function Harness() {
  useResourceIndexing();
  const { open, close } = useCommandPalette();
  return (
    <div>
      <button onClick={open}>open</button>
      <button onClick={close}>close</button>
    </div>
  );
}

function renderHarness(store: ReturnType<typeof buildStore>) {
  return render(
    <Provider store={store}>
      <CommandPaletteProvider>
        <Harness />
      </CommandPaletteProvider>
    </Provider>,
  );
}

/** Flushes the microtask queue enough times for a rejected `httpClient.get` promise to
 * propagate through the thunk's `.catch`, `rejectWithValue`, and the dispatched `.rejected`
 * action to actually commit to the store (several `await Promise.resolve()` hops, not one). */
async function flushMicrotasks(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/** Clicks a button AND flushes a couple of microtask hops in the SAME `act` batch, so a
 * synchronous click that triggers an async dispatch (whose `.pending`/eventual `.rejected`
 * continuation resolves a tick later) never leaves React with an unflushed update by the time
 * the next assertion or click runs -- eliminates the "not wrapped in act" warning noise without
 * changing what any assertion below actually checks. */
async function clickAndSettle(label: string): Promise<void> {
  await act(async () => {
    screen.getByText(label).click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useResourceIndexing — HEL-503 design.md D2 (tasks 2.2/2.3), retry-loop discrimination (evaluator S1)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("does NOT dispatch any fetch before the palette is ever opened — task 2.3", () => {
    const store = buildStore();
    renderHarness(store);
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it("opening once dispatches each of the four kinds' fetch exactly once", () => {
    mockSuccessResponses();
    const store = buildStore();
    renderHarness(store);
    act(() => screen.getByText("open").click());
    expect(mockedGet).toHaveBeenCalledTimes(4);
  });

  // WHAT THIS PROVES: after a `failed` kind genuinely settles (a real rejected promise commits
  // a real `.rejected` action, genuinely re-rendering the component with a new `statuses` value)
  // and several further re-render cycles pass with the SAME palette session still open, the
  // dispatch count for that kind stays at exactly the number of explicit opens — never grows on
  // its own. WHAT IT CANNOT PROVE: a retry storm with a period longer than this test's flush
  // window would still (correctly) not be caught — this asserts boundedness across "several"
  // re-render cycles, not literally forever.
  //
  // FAILABLE BY MUTATION, RUN AND CONFIRMED (see files-modified.md): restoring `statuses.*` to
  // the effect's dependency array in `useResourceIndexing.ts` (the exact pre-fix shape) made the
  // call count keep climbing well past 4 as microtasks flushed with the palette still open,
  // failing the final assertion below; removing `statuses.*` again (the shipped, fixed shape)
  // brought it back to a stable, bounded count.
  it("a genuinely-settled failed kind does NOT keep re-dispatching while the SAME palette session stays open", async () => {
    mockRejectingWithCap(50);
    const store = buildStore();
    renderHarness(store);

    await clickAndSettle("open");
    const countRightAfterOpen = mockedGet.mock.calls.length;
    expect(countRightAfterOpen).toBe(4);

    // Let every one of the four thunks actually settle to `failed`, then let several MORE
    // render cycles pass with `isOpen` still `true` and nothing re-clicked.
    await flushMicrotasks(8);

    // A bounded implementation: the four rejected thunks committed their `.rejected` actions
    // (statuses are genuinely `failed` now), but no NEW dispatch fired on top of the original 4
    // just because those settlements caused re-renders.
    expect(mockedGet).toHaveBeenCalledTimes(4);
  });

  it("re-opening with every kind already succeeded dispatches nothing further", async () => {
    mockSuccessResponses();
    const store = buildStore();
    renderHarness(store);

    await clickAndSettle("open");
    await flushMicrotasks();
    expect(mockedGet).toHaveBeenCalledTimes(4);

    await clickAndSettle("close");
    await clickAndSettle("open");
    await flushMicrotasks();
    expect(mockedGet).toHaveBeenCalledTimes(4);
  });

  it("re-opening with every kind failed re-dispatches all four, exactly once per open", async () => {
    mockRejectingWithCap(50);
    const store = buildStore();
    renderHarness(store);

    await clickAndSettle("open");
    await flushMicrotasks();
    expect(mockedGet).toHaveBeenCalledTimes(4);

    await clickAndSettle("close");
    await clickAndSettle("open");
    await flushMicrotasks();
    expect(mockedGet).toHaveBeenCalledTimes(8);
  });
});
