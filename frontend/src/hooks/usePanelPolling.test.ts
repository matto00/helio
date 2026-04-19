import { act, renderHook } from "@testing-library/react";

import { usePanelPolling } from "./usePanelPolling";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

function fireVisibilityChange() {
  document.dispatchEvent(new Event("visibilitychange"));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("usePanelPolling", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    setVisibility("visible");
  });

  afterEach(() => {
    jest.useRealTimers();
    setVisibility("visible");
  });

  it("does not set an interval when refreshInterval is null", () => {
    const refresh = jest.fn();
    renderHook(() => usePanelPolling(refresh, null, "type-1"));

    act(() => {
      jest.advanceTimersByTime(60_000);
    });

    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not set an interval when typeId is null", () => {
    const refresh = jest.fn();
    renderHook(() => usePanelPolling(refresh, 30, null));

    act(() => {
      jest.advanceTimersByTime(60_000);
    });

    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not set an interval when both are null", () => {
    const refresh = jest.fn();
    renderHook(() => usePanelPolling(refresh, null, null));

    act(() => {
      jest.advanceTimersByTime(60_000);
    });

    expect(refresh).not.toHaveBeenCalled();
  });

  it("calls refresh at the correct cadence", () => {
    const refresh = jest.fn();
    renderHook(() => usePanelPolling(refresh, 30, "type-1"));

    // Not called immediately — first tick is after 30 s
    expect(refresh).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(30_000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(30_000);
    });
    expect(refresh).toHaveBeenCalledTimes(2);

    act(() => {
      jest.advanceTimersByTime(30_000);
    });
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("clears the interval on unmount", () => {
    const refresh = jest.fn();
    const { unmount } = renderHook(() => usePanelPolling(refresh, 30, "type-1"));

    unmount();

    act(() => {
      jest.advanceTimersByTime(60_000);
    });

    expect(refresh).not.toHaveBeenCalled();
  });

  it("clears the interval when typeId changes to null", () => {
    const refresh = jest.fn();
    let typeId: string | null = "type-1";

    const { rerender } = renderHook(() => usePanelPolling(refresh, 30, typeId));

    // Confirm interval fires before the change
    act(() => {
      jest.advanceTimersByTime(30_000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    typeId = null;
    rerender();

    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    // No additional calls after typeId is removed
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("pauses polling when the tab becomes hidden", () => {
    const refresh = jest.fn();
    renderHook(() => usePanelPolling(refresh, 30, "type-1"));

    act(() => {
      jest.advanceTimersByTime(30_000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    // Hide the tab
    act(() => {
      setVisibility("hidden");
      fireVisibilityChange();
    });

    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    // Should not have fired while hidden
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("resumes polling when the tab becomes visible again", () => {
    const refresh = jest.fn();
    renderHook(() => usePanelPolling(refresh, 30, "type-1"));

    // Hide the tab immediately
    act(() => {
      setVisibility("hidden");
      fireVisibilityChange();
    });

    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    expect(refresh).not.toHaveBeenCalled();

    // Show the tab
    act(() => {
      setVisibility("visible");
      fireVisibilityChange();
    });

    act(() => {
      jest.advanceTimersByTime(30_000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(30_000);
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("does not stack duplicate intervals when tab hides and shows repeatedly", () => {
    const refresh = jest.fn();
    renderHook(() => usePanelPolling(refresh, 30, "type-1"));

    // Hide → show → hide → show rapidly
    act(() => {
      setVisibility("hidden");
      fireVisibilityChange();
      setVisibility("visible");
      fireVisibilityChange();
      setVisibility("hidden");
      fireVisibilityChange();
      setVisibility("visible");
      fireVisibilityChange();
    });

    // Advance one interval — should fire exactly once
    act(() => {
      jest.advanceTimersByTime(30_000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    // Advance another interval — exactly two total
    act(() => {
      jest.advanceTimersByTime(30_000);
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("does not start the interval when the tab is hidden on mount", () => {
    setVisibility("hidden");

    const refresh = jest.fn();
    renderHook(() => usePanelPolling(refresh, 30, "type-1"));

    act(() => {
      jest.advanceTimersByTime(60_000);
    });

    expect(refresh).not.toHaveBeenCalled();
  });

  it("always calls the latest refresh callback without recreating the interval", () => {
    const refresh1 = jest.fn();
    const refresh2 = jest.fn();
    let refresh = refresh1;

    const { rerender } = renderHook(() => usePanelPolling(refresh, 30, "type-1"));

    // Update to a new callback identity
    refresh = refresh2;
    rerender();

    act(() => {
      jest.advanceTimersByTime(30_000);
    });

    expect(refresh1).not.toHaveBeenCalled();
    expect(refresh2).toHaveBeenCalledTimes(1);
  });
});
