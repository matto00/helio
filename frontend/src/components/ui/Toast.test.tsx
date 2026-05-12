import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import type { PropsWithChildren } from "react";
import { Provider } from "react-redux";

import { pushToast, toastsReducer } from "../../features/toasts/toastsSlice";
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
  it("renders nothing when there are no toasts", () => {
    renderToastViewport();
    // Viewport container is always present but has no toast children.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders a toast after pushToast is dispatched", () => {
    const { store } = renderToastViewport();

    act(() => {
      store.dispatch(pushToast({ variant: "success", message: "All good!" }));
    });

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("All good!")).toBeInTheDocument();
  });

  it("renders all four variants without throwing", () => {
    const { store } = renderToastViewport();

    act(() => {
      store.dispatch(pushToast({ variant: "info", message: "Info message" }));
      store.dispatch(pushToast({ variant: "success", message: "Success message" }));
      store.dispatch(pushToast({ variant: "warning", message: "Warning message" }));
      store.dispatch(pushToast({ variant: "error", message: "Error message" }));
    });

    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(4);
    expect(screen.getByText("Info message")).toBeInTheDocument();
    expect(screen.getByText("Error message")).toBeInTheDocument();
  });

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

    expect(screen.getByText("Close me.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));

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

    expect(screen.getByText("Auto gone.")).toBeInTheDocument();

    // Advance past the duration and the exit animation.
    act(() => jest.advanceTimersByTime(1200));

    await waitFor(() => {
      expect(store.getState().toasts.items).toHaveLength(0);
    });

    jest.useRealTimers();
  });
});
