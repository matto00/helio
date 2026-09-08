import { configureStore } from "@reduxjs/toolkit";
import { act, render } from "@testing-library/react";
import { useMemo } from "react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { dashboardsReducer } from "../dashboards/state/dashboardsSlice";
import { panelsReducer } from "../panels/state/panelsSlice";
import { pipelinesReducer } from "../pipelines/state/pipelinesSlice";
import { sourcesReducer } from "../sources/state/sourcesSlice";
import { ADD_SOURCE_MODAL_ARIA_LABEL } from "../sources/ui/AddSourceModal";
import { toastsReducer } from "../toasts/state/toastsSlice";
import { CommandPaletteProvider } from "./CommandPaletteProvider";
import { CreateCommandActions, isAddSourceModalAlreadyOpen } from "./CreateCommandActions";
import { useCommandActions, useCommandRegistryActions } from "./hooks";
import type { CommandAction } from "./model/types";

/** evaluation-1.md CR1 — regression guard for the nondeterministic Create-section-order bug.
 *
 * WHAT THIS PROVES: `CreateCommandActions`'s `useCommandActions` effect registers ONCE and does
 * not dispose+re-register on every unrelated re-render. `useCommandActions` (`hooks.ts`) disposes
 * the previous registration and registers again whenever the actions array it's passed changes
 * identity; each such cycle calls the registry's `notify()` twice (once per dispose, once per
 * register — see `commandRegistry.ts`). `useCommandRegistryActions` subscribes to that same
 * `notify()` via `useSyncExternalStore`, so counting how many times a subscribed observer
 * re-renders is a direct measurement of how many register/dispose cycles actually fired — not an
 * inference from final ID order, which (per `commandRegistry.ts`'s `Map`-is-insertion-order
 * behavior) can settle into the SAME final order whether it churned once or many times. This
 * mattered concretely here: an earlier draft of this guard compared only the final captured
 * order across renders and passed even against the unmemoized (buggy) version, because a single
 * churn event stabilizes the relative order of exactly two registrants for every render after it.
 *
 * WHAT THIS CANNOT PROVE: real end-to-end determinism across a fresh page load in a browser (a
 * different mount path than `render()`'s) — that is `e2e/hel516-palette-quick-create.spec.ts`'s
 * job. This is the render-level, mutation-provable half.
 *
 * FAILABLE BY MUTATION: reverting `CreateCommandActions.tsx` to memoize on the seams' own
 * `CreateActionResult` objects directly (their pre-fix form — a fresh object every render, so the
 * `useMemo` dep array changes every render) turns this red — verified by re-running this test
 * against that reverted version during development (observed churn count in the hundreds against
 * an expected bound of ~10 for 5 external re-renders). */
function OtherStableRegistrant() {
  // Memoized so THIS registrant is the stable control — isolates the churn variable to
  // `CreateCommandActions` alone, which is what this guard is about.
  const actions = useMemo<CommandAction[]>(
    () => [{ id: "other.stable", title: "Other", run: () => {} }],
    [],
  );
  useCommandActions(actions);
  return null;
}

function CapturedOrder({ onCapture }: { onCapture: (ids: string[]) => void }) {
  const actions = useCommandRegistryActions();
  onCapture(actions.map((a) => a.id));
  return null;
}

function buildStore() {
  return configureStore({
    reducer: {
      dashboards: dashboardsReducer,
      panels: panelsReducer,
      pipelines: pipelinesReducer,
      sources: sourcesReducer,
      toasts: toastsReducer,
    },
  });
}

describe("CreateCommandActions — evaluation-1.md CR1 regression guard", () => {
  it("does not re-register (dispose+register) on unrelated re-renders", () => {
    const store = buildStore();
    const captures: string[][] = [];

    function Harness({ tick }: { tick: number }) {
      return (
        <Provider store={store}>
          <CommandPaletteProvider>
            <OtherStableRegistrant />
            <CreateCommandActions />
            <CapturedOrder onCapture={(ids) => captures.push(ids)} />
            {/* Unrelated prop forces every child (including CreateCommandActions) to re-render
              without changing anything the seams actually read. */}
            <span data-testid="tick">{tick}</span>
          </CommandPaletteProvider>
        </Provider>
      );
    }

    let renderResult!: ReturnType<typeof render>;
    act(() => {
      renderResult = render(<Harness tick={0} />);
    });
    const { rerender } = renderResult;
    const capturesAfterMount = captures.length;

    const RERENDER_COUNT = 5;
    for (let tick = 1; tick <= RERENDER_COUNT; tick++) {
      act(() => {
        rerender(<Harness tick={tick} />);
      });
    }

    // Each of the 5 external re-renders should cause AT MOST one extra `notify()`-driven capture
    // (there shouldn't be any, since nothing subscribed actually changed — this bound is
    // deliberately generous rather than exactly `capturesAfterMount`, to avoid coupling to
    // React's own re-render-batching internals). A dispose+register churn on every render would
    // instead add roughly 2 extra captures PER re-render (10+ over 5 ticks), which is what the
    // pre-fix version that memoized on the seams' own fresh-every-render objects produced.
    const capturesDuringRerenders = captures.length - capturesAfterMount;
    expect(capturesDuringRerenders).toBeLessThanOrEqual(RERENDER_COUNT);

    // Sanity: the Create ids and the other registrant's id are all actually present, so this
    // isn't vacuously passing on an empty/degenerate registration.
    expect(captures[captures.length - 1]).toEqual(
      expect.arrayContaining([
        "other.stable",
        "create.dashboard",
        "create.source",
        "create.pipeline",
      ]),
    );
  });
});

/** evaluation-1.md CR2 — the nested-modal collision guard, exercising BOTH branches.
 *
 * WHAT THIS PROVES: (a) `isAddSourceModalAlreadyOpen()` reads DOM presence correctly in both
 * directions (no matching `dialog[open]` -> false; one present -> true) — legitimate in jsdom
 * since this is presence-only, not focus/visibility/computed style (evidence rule 3 is not
 * engaged); and (b) the palette's registered "Add source" action actually WIRES that check —
 * dispatching `setAddSourceModalOpen(true)` when no instance is open, and doing NOTHING when one
 * already is (asserted via the Redux store's own state, not by re-deriving the same check).
 *
 * WHAT THIS CANNOT PROVE: the real-browser nested case (a genuine `CreatePipelineModal`-hosted
 * `AddSourceModal` opened via its own local state, then running the palette action against it)
 * — that is `e2e/hel516-palette-quick-create.spec.ts`'s "never presented twice — nested" case,
 * task 1.5's explicit "verify in a real browser, not by reasoning" requirement. */
describe("useAddSourceAction collision guard (evaluation-1.md CR2)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("isAddSourceModalAlreadyOpen reads DOM presence in both directions", () => {
    expect(isAddSourceModalAlreadyOpen()).toBe(false);

    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    dialog.setAttribute("aria-label", ADD_SOURCE_MODAL_ARIA_LABEL);
    document.body.appendChild(dialog);

    expect(isAddSourceModalAlreadyOpen()).toBe(true);
  });

  function renderHarness() {
    const store = configureStore({
      reducer: {
        dashboards: dashboardsReducer,
        panels: panelsReducer,
        pipelines: pipelinesReducer,
        sources: sourcesReducer,
        toasts: toastsReducer,
      },
    });
    const capturedActions: CommandAction[][] = [];
    function Capture() {
      const actions = useCommandRegistryActions();
      capturedActions.push(actions);
      return null;
    }
    act(() => {
      render(
        <MemoryRouter>
          <Provider store={store}>
            <CommandPaletteProvider>
              <CreateCommandActions />
              <Capture />
            </CommandPaletteProvider>
          </Provider>
        </MemoryRouter>,
      );
    });
    const latestActions = capturedActions[capturedActions.length - 1];
    const sourceAction = latestActions.find((a) => a.id === "create.source")!;
    return { store, sourceAction };
  }

  it("dispatches setAddSourceModalOpen(true) when no AddSourceModal instance is open", () => {
    const { store, sourceAction } = renderHarness();
    expect(store.getState().sources.addModalOpen).toBe(false);

    act(() => sourceAction.run());

    expect(store.getState().sources.addModalOpen).toBe(true);
  });

  it("does NOT dispatch when a matching AddSourceModal dialog is already open (nested-instance collision)", () => {
    const { store, sourceAction } = renderHarness();
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    dialog.setAttribute("aria-label", ADD_SOURCE_MODAL_ARIA_LABEL);
    document.body.appendChild(dialog);

    act(() => sourceAction.run());

    expect(store.getState().sources.addModalOpen).toBe(false);
  });
});
