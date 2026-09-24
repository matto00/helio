// HEL-1096 tasks.md 3.7 (design.md's "denial reason and action are computed-ARIA accessible"
// requirement; Standing Constraints C4/C6): an action-carrying denial toast never auto-dismisses,
// is keyboard-reachable/operable, and its reason text is announced via COMPUTED ARIA (a live
// region), not merely present in the DOM. Renders the REAL `ToastViewport` + `toastsSlice`
// reducer (mirrors `Toast.test.tsx`'s own pattern) fed by `buildDeniedPipelinesToast`'s actual
// output, rather than a hand-built toast payload — this is what proves OUR wiring produces an
// accessible toast, not just that `Toast.tsx` is generically capable of one.

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import type { PropsWithChildren } from "react";
import { Provider } from "react-redux";

import { ToastViewport } from "../../../shared/ui/Toast";
import { pushToast, toastsReducer, DEFAULT_DURATION } from "../../toasts/state/toastsSlice";
import { buildDeniedPipelinesToast } from "./deniedPipelinesToast";
import type { DeniedPipelineResponse } from "../../sources/types/dataSource";

const aiDenial: DeniedPipelineResponse = {
  pipelineId: "p1",
  name: "Sentiment pipe",
  reasons: [{ code: "ai-step", detail: "Step 's1' uses AI op 'analyzewithai'", stepId: "s1" }],
  canRun: true,
};

function makeStore() {
  return configureStore({ reducer: { toasts: toastsReducer } });
}

function renderToastViewport() {
  const store = makeStore();
  function Wrapper({ children }: PropsWithChildren) {
    return <Provider store={store}>{children}</Provider>;
  }
  render(<ToastViewport />, { wrapper: Wrapper });
  return { store };
}

describe("denied-pipeline toast accessibility (HEL-1096 C4/C6)", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("C6: an action-carrying denial toast never auto-dismisses, even long after the default duration", () => {
    jest.useFakeTimers();
    const { store } = renderToastViewport();

    act(() => {
      store.dispatch(pushToast(buildDeniedPipelinesToast([aiDenial], jest.fn())));
    });
    expect(store.getState().toasts.items).toHaveLength(1);
    expect(store.getState().toasts.items[0]?.duration).toBe(0);

    // Advance well past the shared component's normal auto-dismiss window (DEFAULT_DURATION) —
    // a `duration: 0` toast must still be present.
    act(() => {
      jest.advanceTimersByTime(DEFAULT_DURATION * 10);
    });
    expect(store.getState().toasts.items).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Run to update" })).toBeInTheDocument();
  });

  it("C4: the reason is exposed via a computed accessible live-region announcement, not just visible DOM text", () => {
    const { store } = renderToastViewport();

    act(() => {
      store.dispatch(pushToast(buildDeniedPipelinesToast([aiDenial], jest.fn())));
    });

    // The visible card shows the message (aria-hidden -- Toast.tsx's own D2 design), so the
    // COMPUTED announcement path is the live region: `role="status"` (polite, matching this
    // toast's `warning` variant) actually contains the same text.
    const liveRegion = screen.getByRole("status");
    expect(within(liveRegion).getByText(/Sentiment pipe/)).toBeInTheDocument();
    expect(liveRegion).toHaveAttribute("aria-live", "polite");
  });

  it("the 'Run to update' action is keyboard-reachable (a real, non-disabled <button>) and operable", () => {
    const onRunToUpdate = jest.fn();
    const { store } = renderToastViewport();

    act(() => {
      store.dispatch(pushToast(buildDeniedPipelinesToast([aiDenial], onRunToUpdate)));
    });

    const actionBtn = screen.getByRole("button", { name: "Run to update" });
    expect(actionBtn.tagName).toBe("BUTTON");
    expect(actionBtn).not.toBeDisabled();
    // A native, non-disabled <button> is in the default (0) tab order unless explicitly removed —
    // asserting no NEGATIVE tabindex was added is what would catch a future regression that
    // silently makes it unreachable by keyboard.
    expect(actionBtn.tabIndex).toBeGreaterThanOrEqual(0);

    actionBtn.focus();
    expect(actionBtn).toHaveFocus();

    fireEvent.click(actionBtn);
    expect(onRunToUpdate).toHaveBeenCalledTimes(1);
  });

  it("the action is associated with the reason text via aria-describedby", () => {
    const { store } = renderToastViewport();

    act(() => {
      store.dispatch(pushToast(buildDeniedPipelinesToast([aiDenial], jest.fn())));
    });

    const actionBtn = screen.getByRole("button", { name: "Run to update" });
    const describedById = actionBtn.getAttribute("aria-describedby");
    expect(describedById).toBeTruthy();
    expect(document.getElementById(describedById as string)?.textContent).toMatch(/Sentiment pipe/);
  });
});
