import { renderHook, waitFor } from "@testing-library/react";

import { createSseMock } from "../../../test/sseMock";
import { useDashboardAuthoringStream } from "./useDashboardAuthoringStream";

let originalFetch: typeof global.fetch;

beforeEach(() => {
  originalFetch = global.fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("useDashboardAuthoringStream", () => {
  it("POSTs {goal} with credentials: include when active=true", async () => {
    const { controller, fetchMock } = createSseMock();
    global.fetch = fetchMock;

    renderHook(() => useDashboardAuthoringStream({ goal: "Sales overview", active: true }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/authoring/dashboard?stream=true",
        expect.objectContaining({
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", "X-Helio-Requested-With": "1" },
          body: JSON.stringify({ goal: "Sales overview" }),
        }),
      );
    });

    controller.close();
  });

  // HEL-395 evaluation cycle 1: httpClient (axios) sets this CSRF header by
  // default on every mutating request (httpClient.test.ts's own "sets the
  // CSRF header by default on every request" assertion); this hook bypasses
  // httpClient for streaming (design.md D2), so it must set the header
  // itself or AuthDirectives.requireCsrfHeader 403s every real
  // session-authenticated request -- reproduced live before this fix.
  it("sets the CSRF header (X-Helio-Requested-With) on the streaming POST", async () => {
    const { controller, fetchMock } = createSseMock();
    global.fetch = fetchMock;

    renderHook(() => useDashboardAuthoringStream({ goal: "Sales overview", active: true }));

    await waitFor(() => {
      const [, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
      expect(init.headers["X-Helio-Requested-With"]).toBe("1");
    });

    controller.close();
  });

  it("does not call fetch when active=false", () => {
    const { fetchMock } = createSseMock();
    global.fetch = fetchMock;

    renderHook(() => useDashboardAuthoringStream({ goal: "Sales overview", active: false }));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accumulates authoring-progress text deltas", async () => {
    const { controller, fetchMock } = createSseMock();
    global.fetch = fetchMock;

    const { result } = renderHook(() =>
      useDashboardAuthoringStream({ goal: "Sales overview", active: true }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    controller.push("authoring-progress", { text: '{"dashboardName' });
    await waitFor(() => expect(result.current.progressText).toBe('{"dashboardName'));

    controller.push("authoring-progress", { text: '":"Sales"' });
    await waitFor(() => expect(result.current.progressText).toBe('{"dashboardName":"Sales"'));

    controller.close();
  });

  it("surfaces the authoring-status label", async () => {
    const { controller, fetchMock } = createSseMock();
    global.fetch = fetchMock;

    const { result } = renderHook(() =>
      useDashboardAuthoringStream({ goal: "Sales overview", active: true }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    controller.push("authoring-status", { label: "repairing" });
    await waitFor(() => expect(result.current.statusLabel).toBe("repairing"));

    controller.close();
  });

  it("parses a terminal authoring-result event", async () => {
    const { controller, fetchMock } = createSseMock();
    global.fetch = fetchMock;

    const { result } = renderHook(() =>
      useDashboardAuthoringStream({ goal: "Sales overview", active: true }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const proposal = { dashboardName: "Sales overview", panels: [] };
    controller.push("authoring-result", { proposal, warnings: ["some warning"] });

    await waitFor(() => {
      expect(result.current.result).toEqual({ proposal, warnings: ["some warning"] });
      expect(result.current.error).toBeNull();
      expect(result.current.connectionError).toBeNull();
    });

    controller.close();
  });

  // ── conversationId (HEL-397) ─────────────────────────────────────────────

  it("POSTs conversationId in the request body when provided", async () => {
    const { controller, fetchMock } = createSseMock();
    global.fetch = fetchMock;

    renderHook(() =>
      useDashboardAuthoringStream({
        goal: "Make it a bar chart",
        active: true,
        conversationId: "conv-1",
      }),
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/authoring/dashboard?stream=true",
        expect.objectContaining({
          body: JSON.stringify({ goal: "Make it a bar chart", conversationId: "conv-1" }),
        }),
      );
    });

    controller.close();
  });

  it("a terminal authoring-result event's conversationId is exposed on state.result", async () => {
    const { controller, fetchMock } = createSseMock();
    global.fetch = fetchMock;

    const { result } = renderHook(() =>
      useDashboardAuthoringStream({ goal: "Sales overview", active: true }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const proposal = { dashboardName: "Sales overview", panels: [] };
    controller.push("authoring-result", { proposal, warnings: [], conversationId: "conv-1" });

    await waitFor(() => {
      expect(result.current.result?.conversationId).toBe("conv-1");
    });

    controller.close();
  });

  it("parses a terminal authoring-error event", async () => {
    const { controller, fetchMock } = createSseMock();
    global.fetch = fetchMock;

    const { result } = renderHook(() =>
      useDashboardAuthoringStream({ goal: "Sales overview", active: true }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    controller.push("authoring-error", { message: "Claude call failed" });

    await waitFor(() => {
      expect(result.current.error).toBe("Claude call failed");
      expect(result.current.result).toBeNull();
    });

    controller.close();
  });

  it("sets connectionError when the response is not text/event-stream", async () => {
    const { fetchMock } = createSseMock({ ok: false, contentType: "application/json" });
    global.fetch = fetchMock;

    const { result } = renderHook(() =>
      useDashboardAuthoringStream({ goal: "Sales overview", active: true }),
    );

    await waitFor(() => {
      expect(result.current.connectionError).toMatch(/Unexpected response/);
    });
  });

  it("resets state on a fresh attempt (active flips false -> true again)", async () => {
    const first = createSseMock();
    global.fetch = first.fetchMock;

    const { result, rerender } = renderHook(
      (props: { goal: string; active: boolean }) => useDashboardAuthoringStream(props),
      { initialProps: { goal: "Sales overview", active: true } },
    );

    await waitFor(() => expect(first.fetchMock).toHaveBeenCalled());
    first.controller.push("authoring-error", { message: "boom" });
    await waitFor(() => expect(result.current.error).toBe("boom"));

    // Drop back to inactive (as the drawer does when "Try again" is clicked).
    rerender({ goal: "Sales overview", active: false });

    const second = createSseMock();
    global.fetch = second.fetchMock;
    rerender({ goal: "Sales overview take two", active: true });

    await waitFor(() => expect(second.fetchMock).toHaveBeenCalled());
    expect(result.current.error).toBeNull();

    second.controller.close();
  });

  it("aborts the in-flight fetch when active flips to false", async () => {
    const { controller, fetchMock } = createSseMock();
    global.fetch = fetchMock;

    const { rerender } = renderHook(
      (props: { active: boolean }) =>
        useDashboardAuthoringStream({ goal: "Sales overview", active: props.active }),
      { initialProps: { active: true } },
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    rerender({ active: false });

    const signal = (fetchMock.mock.calls[0] as [string, { signal: AbortSignal }])[1].signal;
    expect(signal.aborted).toBe(true);

    controller.close();
  });

  it("aborts the in-flight fetch on unmount", async () => {
    const { controller, fetchMock } = createSseMock();
    global.fetch = fetchMock;

    const { unmount } = renderHook(() =>
      useDashboardAuthoringStream({ goal: "Sales overview", active: true }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    unmount();

    const signal = (fetchMock.mock.calls[0] as [string, { signal: AbortSignal }])[1].signal;
    expect(signal.aborted).toBe(true);

    controller.close();
  });
});
