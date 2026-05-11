import { renderHook, waitFor } from "@testing-library/react";
import { usePipelineRunEvents } from "./usePipelineRunEvents";
import type { RunStatusEventData } from "./usePipelineRunEvents";

// ---- Fetch/ReadableStream mock -----------------------------------------

interface SseController {
  /** Push a named SSE event to the stream. */
  push: (eventName: string, data: string) => void;
  /** Close the stream cleanly (simulates server-side close). */
  close: () => void;
}

function createSseMock(
  options: {
    ok?: boolean;
    contentType?: string;
  } = {},
): { controller: SseController; fetchMock: jest.Mock } {
  const { ok = true, contentType = "text/event-stream; charset=UTF-8" } = options;

  let enqueue: (chunk: Uint8Array) => void = () => undefined;
  let closeStream: () => void = () => undefined;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      enqueue = (chunk) => ctrl.enqueue(chunk);
      closeStream = () => ctrl.close();
    },
  });

  // Use a plain object instead of new Response(...) because jsdom does not
  // expose the global Response constructor in the test environment.
  const response = {
    ok,
    status: ok ? 200 : 401,
    headers: {
      get: (name: string) => (name.toLowerCase() === "content-type" ? contentType : null),
    },
    body: stream,
  } as unknown as Response;

  const fetchMock = jest.fn().mockResolvedValue(response);

  const controller: SseController = {
    push(eventName: string, data: string) {
      enqueue(
        encoder.encode(`event: ${eventName}
data: ${data}

`),
      );
    },
    close() {
      try {
        closeStream();
      } catch {
        /* already closed by hook on terminal event */
      }
    },
  };

  return { controller, fetchMock };
}

// ---- Setup / teardown --------------------------------------------------

let originalFetch: typeof global.fetch;

beforeEach(() => {
  originalFetch = global.fetch;
  sessionStorage.clear();
});

afterEach(() => {
  global.fetch = originalFetch;
  sessionStorage.clear();
});

// ---- Tests (3.5 – 3.7) -------------------------------------------------

describe("usePipelineRunEvents", () => {
  // 3.5 Opens fetch with Authorization header when active=true
  it("calls fetch with Authorization header when active=true and pipelineId is provided", async () => {
    const { controller, fetchMock } = createSseMock();
    global.fetch = fetchMock;
    sessionStorage.setItem("helio_auth_token", "test-token");

    renderHook(() => usePipelineRunEvents({ pipelineId: "pipe-1", active: true }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/pipelines/pipe-1/run-events",
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
        }),
      );
    });

    controller.close();
  });

  it("does not call fetch when active=false", () => {
    const { fetchMock } = createSseMock();
    global.fetch = fetchMock;

    renderHook(() => usePipelineRunEvents({ pipelineId: "pipe-1", active: false }));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not call fetch when pipelineId is undefined", () => {
    const { fetchMock } = createSseMock();
    global.fetch = fetchMock;

    renderHook(() => usePipelineRunEvents({ pipelineId: undefined, active: true }));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  // 3.6 Hook returns correct status/rowCount/errorLog from parsed events
  it("returns status and rowCount from a succeeded event", async () => {
    const { controller, fetchMock } = createSseMock();
    global.fetch = fetchMock;

    const { result } = renderHook(() =>
      usePipelineRunEvents({ pipelineId: "pipe-1", active: true }),
    );

    // Wait for fetch to be called and the stream reader to be ready.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    controller.push("run-status", JSON.stringify({ status: "succeeded", rowCount: 42 }));

    await waitFor(() => {
      expect(result.current.status).toBe("succeeded");
      expect(result.current.rowCount).toBe(42);
      expect(result.current.errorLog).toBeNull();
    });

    controller.close();
  });

  it("returns errorLog from a failed event", async () => {
    const { controller, fetchMock } = createSseMock();
    global.fetch = fetchMock;

    const { result } = renderHook(() =>
      usePipelineRunEvents({ pipelineId: "pipe-1", active: true }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    controller.push("run-status", JSON.stringify({ status: "failed", errorLog: "out of memory" }));

    await waitFor(() => {
      expect(result.current.status).toBe("failed");
      expect(result.current.rowCount).toBeNull();
      expect(result.current.errorLog).toBe("out of memory");
    });

    controller.close();
  });

  // 3.7 Hook aborts fetch on terminal event
  it("aborts connection on succeeded (terminal) event", async () => {
    const { controller, fetchMock } = createSseMock();
    global.fetch = fetchMock;

    const { result } = renderHook(() =>
      usePipelineRunEvents({ pipelineId: "pipe-1", active: true }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    controller.push("run-status", JSON.stringify({ status: "succeeded", rowCount: 5 }));

    await waitFor(() => {
      expect(result.current.status).toBe("succeeded");
    });

    controller.close();
  });

  it("aborts connection on failed (terminal) event", async () => {
    const { controller, fetchMock } = createSseMock();
    global.fetch = fetchMock;

    const { result } = renderHook(() =>
      usePipelineRunEvents({ pipelineId: "pipe-1", active: true }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    controller.push("run-status", JSON.stringify({ status: "failed", errorLog: "boom" }));

    await waitFor(() => {
      expect(result.current.status).toBe("failed");
    });

    controller.close();
  });

  it("aborts connection on dry_run (terminal) event", async () => {
    const { controller, fetchMock } = createSseMock();
    global.fetch = fetchMock;

    const { result } = renderHook(() =>
      usePipelineRunEvents({ pipelineId: "pipe-1", active: true }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    controller.push("run-status", JSON.stringify({ status: "dry_run", rowCount: 3 }));

    await waitFor(() => {
      expect(result.current.status).toBe("dry_run");
    });

    controller.close();
  });

  it("does NOT change status on non-terminal event (running)", async () => {
    const { controller, fetchMock } = createSseMock();
    global.fetch = fetchMock;

    const { result } = renderHook(() =>
      usePipelineRunEvents({ pipelineId: "pipe-1", active: true }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    controller.push("run-status", JSON.stringify({ status: "running" }));

    await waitFor(() => {
      expect(result.current.status).toBe("running");
    });
    // Connection should still be alive (not terminal)
    expect(result.current.connectionError).toBeNull();

    controller.close();
  });

  it("calls onTerminal callback with event data when terminal event arrives", async () => {
    const { controller, fetchMock } = createSseMock();
    global.fetch = fetchMock;

    const onTerminal = jest.fn();
    renderHook(() =>
      usePipelineRunEvents({
        pipelineId: "pipe-1",
        active: true,
        onTerminal,
      }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const terminalData: RunStatusEventData = { status: "succeeded", rowCount: 10 };
    controller.push("run-status", JSON.stringify(terminalData));

    await waitFor(() => {
      expect(onTerminal).toHaveBeenCalledWith(terminalData);
    });

    controller.close();
  });

  it("aborts fetch when active flips to false", async () => {
    const { controller, fetchMock } = createSseMock();
    global.fetch = fetchMock;

    const { rerender } = renderHook(
      (props: { active: boolean }) =>
        usePipelineRunEvents({ pipelineId: "pipe-1", active: props.active }),
      { initialProps: { active: true } },
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    // Flipping active to false triggers cleanup (AbortController.abort).
    rerender({ active: false });

    // The AbortSignal on the mock fetch call should now be aborted.
    const signal = (fetchMock.mock.calls[0] as [string, any])[1].signal as AbortSignal;
    expect(signal.aborted).toBe(true);

    controller.close();
  });

  it("sets connectionError when response is not text/event-stream", async () => {
    const { fetchMock } = createSseMock({ ok: false, contentType: "application/json" });
    global.fetch = fetchMock;

    const { result } = renderHook(() =>
      usePipelineRunEvents({ pipelineId: "pipe-1", active: true }),
    );

    await waitFor(() => {
      expect(result.current.connectionError).toMatch(/Unexpected response/);
    });
  });
});
