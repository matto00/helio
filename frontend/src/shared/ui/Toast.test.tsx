import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import type { PropsWithChildren } from "react";
import { Provider } from "react-redux";

import { pushToast, toastsReducer } from "../../features/toasts/state/toastsSlice";
import { ToastViewport } from "./Toast";

// Minimal store for toast tests — avoids full app store complexity.
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

describe("ToastViewport", () => {
  // HEL-535 5.0a — rewritten to the new contract: the assertive live region
  // is now mounted unconditionally, from first render (D2), so `role="alert"`
  // exists with NO toasts present. This is the whole point of the
  // always-mounted design (an announcement must never depend on a region
  // created together with its content) — do NOT "fix" this by mounting the
  // region lazily, which would silently destroy that guarantee.
  it("mounts both live regions before any toast exists", () => {
    renderToastViewport();
    const politeRegion = screen.getByRole("status");
    const assertiveRegion = screen.getByRole("alert");
    expect(politeRegion).toBeInTheDocument();
    expect(assertiveRegion).toBeInTheDocument();
    expect(politeRegion).toBeEmptyDOMElement();
    expect(assertiveRegion).toBeEmptyDOMElement();
  });

  // F-154 — a bare <div aria-label> has no accessible role, so axe's `aria-prohibited-attr` drops
  // it from the a11y tree entirely; `role="region"` gives the viewport a real landmark.
  it("exposes the viewport as a labeled region landmark", () => {
    renderToastViewport();
    expect(screen.getByRole("region", { name: "Notifications" })).toBeInTheDocument();
  });

  it("renders a toast after pushToast is dispatched", () => {
    const { store } = renderToastViewport();

    act(() => {
      store.dispatch(pushToast({ variant: "success", message: "All good!" }));
    });

    // The message now exists twice — once (aria-hidden) in the visible card,
    // once in the polite live region — so scope to the visible card.
    const region = screen.getByRole("region", { name: "Notifications" });
    expect(within(region).getByText("All good!")).toBeInTheDocument();
  });

  // HEL-535 5.0a — rewritten: `role="alert"` is no longer per-toast (D2). Each
  // variant is pushed and dismissed in turn (rather than all four at once) so
  // the D1 concurrent-toast cap (3) doesn't evict the first one before this
  // gets to assert on it — cap behaviour has its own coverage in
  // toastsSlice.test.ts.
  it.each(["info", "success", "warning", "error"] as const)(
    "renders the %s variant without throwing",
    (variant) => {
      const { store } = renderToastViewport();

      act(() => {
        store.dispatch(pushToast({ variant, message: `${variant} message` }));
      });

      const region = screen.getByRole("region", { name: "Notifications" });
      expect(within(region).getByText(`${variant} message`)).toBeInTheDocument();
    },
  );

  it("renders the action button when provided", () => {
    const { store } = renderToastViewport();
    const onClick = jest.fn();

    act(() => {
      store.dispatch(
        pushToast({
          variant: "error",
          message: "Something went wrong.",
          action: { label: "Retry", onClick },
        }),
      );
    });

    const actionBtn = screen.getByRole("button", { name: "Retry" });
    expect(actionBtn).toBeInTheDocument();
  });

  it("calls the action onClick handler when clicked", () => {
    const { store } = renderToastViewport();
    const onClick = jest.fn();

    act(() => {
      store.dispatch(
        pushToast({
          variant: "warning",
          message: "Heads up.",
          action: { label: "View details", onClick },
        }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "View details" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("dismisses the toast when the close button is clicked", async () => {
    const { store } = renderToastViewport();

    act(() => {
      store.dispatch(pushToast({ variant: "info", message: "Close me." }));
    });

    const region = screen.getByRole("region", { name: "Notifications" });
    expect(within(region).getByText("Close me.")).toBeInTheDocument();

    // HEL-718: the dismiss button kept its bespoke 20px recipe (below
    // IconButton's 24px floor) but gained a visible title tooltip pairing
    // its pre-existing aria-label.
    const dismissButton = screen.getByRole("button", { name: "Dismiss notification" });
    expect(dismissButton).toHaveAttribute("title", "Dismiss notification");
    fireEvent.click(dismissButton);

    // After exit animation (200ms) the store item is removed.
    await waitFor(() => {
      expect(store.getState().toasts.items).toHaveLength(0);
    });
  });

  it("auto-dismisses after the configured duration", async () => {
    jest.useFakeTimers();
    const { store } = renderToastViewport();

    act(() => {
      store.dispatch(pushToast({ variant: "success", message: "Auto gone.", duration: 1000 }));
    });

    const region = screen.getByRole("region", { name: "Notifications" });
    expect(within(region).getByText("Auto gone.")).toBeInTheDocument();

    // Advance past the duration and the exit animation.
    act(() => jest.advanceTimersByTime(1200));

    await waitFor(() => {
      expect(store.getState().toasts.items).toHaveLength(0);
    });

    jest.useRealTimers();
  });

  // HEL-535 5.6 — D2: live-region routing by intent, present before any
  // toast, and a coalesced repeat re-mounts (re-announces) in its region.
  describe("live-region routing (D2)", () => {
    it("routes an error toast's message into the assertive region only", () => {
      const { store } = renderToastViewport();
      act(() => {
        store.dispatch(pushToast({ variant: "error", message: "Something broke." }));
      });
      const assertiveRegion = screen.getByRole("alert");
      const politeRegion = screen.getByRole("status");
      expect(within(assertiveRegion).getByText("Something broke.")).toBeInTheDocument();
      expect(within(politeRegion).queryByText("Something broke.")).not.toBeInTheDocument();
    });

    it.each(["success", "info", "warning"] as const)(
      "routes a %s toast's message into the polite region only",
      (variant) => {
        const { store } = renderToastViewport();
        act(() => {
          store.dispatch(pushToast({ variant, message: "Routed message." }));
        });
        const politeRegion = screen.getByRole("status");
        const assertiveRegion = screen.getByRole("alert");
        expect(within(politeRegion).getByText("Routed message.")).toBeInTheDocument();
        expect(within(assertiveRegion).queryByText("Routed message.")).not.toBeInTheDocument();
      },
    );

    it("re-mounts a coalesced repeat's node in its live region (re-announced, not a no-op)", () => {
      const { store } = renderToastViewport();
      act(() => {
        store.dispatch(pushToast({ variant: "error", message: "Repeated failure." }));
      });
      const assertiveRegion = screen.getByRole("alert");
      const firstNode = within(assertiveRegion).getByText("Repeated failure.");

      act(() => {
        store.dispatch(pushToast({ variant: "error", message: "Repeated failure." }));
      });
      const secondNode = within(assertiveRegion).getByText("Repeated failure.");
      // Coalescing (toastsSlice D1) replaces the toast with a fresh id, so
      // the live region's keyed child is a genuinely new DOM node, not a
      // text mutation on the same node — this is what makes it re-announced.
      expect(secondNode).not.toBe(firstNode);
      expect(within(assertiveRegion).getAllByText("Repeated failure.")).toHaveLength(1);
    });

    // skeptic-final-1.md CR1 — `role="status"`/`role="alert"` each carry an
    // IMPLICIT `aria-atomic="true"` per the ARIA spec (confirmed live via
    // Chrome's computed accessibility tree, not just the markup — an absent
    // attribute does NOT mean non-atomic for these two roles). This
    // assertion previously checked `not.toHaveAttribute("aria-atomic")`,
    // which is exactly the state that leaves the region atomic — it passed
    // while the regions were still atomic under cycle 1's fix. The explicit
    // `aria-atomic="false"` is what actually restricts announcement to the
    // newly added node; a region can hold up to MAX_VISIBLE_TOASTS children,
    // and without it a third stacked toast re-announces the first two along
    // with it, contradicting D2's own "nothing is announced twice" goal.
    it("both live regions are explicitly non-atomic, even once holding multiple messages", () => {
      const { store } = renderToastViewport();
      act(() => {
        store.dispatch(pushToast({ variant: "error", message: "First failure." }));
        store.dispatch(pushToast({ variant: "error", message: "Second failure." }));
      });
      const assertiveRegion = screen.getByRole("alert");
      const politeRegion = screen.getByRole("status");
      expect(within(assertiveRegion).getAllByText(/failure\.$/)).toHaveLength(2);
      expect(assertiveRegion).toHaveAttribute("aria-atomic", "false");
      expect(politeRegion).toHaveAttribute("aria-atomic", "false");
    });
  });

  // HEL-535 5.7 — D2: the visible card carries no live-region role and its
  // message is hidden from assistive tech; action/dismiss stay reachable.
  describe("visible card carries no live-region role (D2)", () => {
    it("the visible toast element has no role or aria-live of its own", () => {
      const { store } = renderToastViewport();
      act(() => {
        store.dispatch(pushToast({ variant: "success", message: "Saved." }));
      });
      const region = screen.getByRole("region", { name: "Notifications" });
      const card = within(region).getByText("Saved.").closest(".toast");
      expect(card).not.toBeNull();
      expect(card).not.toHaveAttribute("role");
      expect(card).not.toHaveAttribute("aria-live");
      expect(card).not.toHaveAttribute("aria-atomic");
    });

    it("the visible message is aria-hidden, but dismiss/action controls remain reachable by role", () => {
      const { store } = renderToastViewport();
      const onClick = jest.fn();
      act(() => {
        store.dispatch(
          pushToast({
            variant: "warning",
            message: "Careful.",
            action: { label: "Undo", onClick },
          }),
        );
      });
      const region = screen.getByRole("region", { name: "Notifications" });
      const visibleMessage = within(region).getByText("Careful.");
      expect(visibleMessage).toHaveAttribute("aria-hidden", "true");
      expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Dismiss notification" })).toBeInTheDocument();
    });
  });

  // HEL-535 5.8 — D4: dismissal is immediate under reduced motion.
  describe("reduced motion (D4)", () => {
    const originalMatchMedia = window.matchMedia;

    afterEach(() => {
      window.matchMedia = originalMatchMedia;
    });

    it("removes the toast immediately (no exit-animation delay) when reduced motion is preferred", async () => {
      window.matchMedia = jest.fn().mockImplementation((query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      })) as unknown as typeof window.matchMedia;

      const { store } = renderToastViewport();
      act(() => {
        store.dispatch(pushToast({ variant: "info", message: "Gone now." }));
      });

      fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));

      // No timer advance needed — reduced motion skips the exit delay
      // synchronously, so the store update should already have happened.
      expect(store.getState().toasts.items).toHaveLength(0);
    });
  });
});
