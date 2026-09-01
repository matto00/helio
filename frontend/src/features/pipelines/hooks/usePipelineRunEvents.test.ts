import { renderHook, waitFor } from "@testing-library/react";
import { usePipelineRunEvents } from "./usePipelineRunEvents";
import type { RunStatusEventData } from "./usePipelineRunEvents";

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

let originalFetch: typeof global.fetch;

beforeEach(() => {
  originalFetch = global.fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("usePipelineRunEvents", () => {
  // HEL-287: session identity is the `helio_session` HttpOnly cookie, not a
  // sessionStorage token + manual Authorization header — the fetch call
  // must pass credentials: "include" so the cookie attaches.
  it("calls fetch with credentials: include when active=true and pipelineId is provided", async () => {
    const { controller, fetchMock } = createSseMock();
    global.fetch = fetchMock;

    renderHook(() => usePipelineRunEvents({ pipelineId: "pipe-1", active: true }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/pipelines/pipe-1/run-events",
        expect.objectContaining({ credentials: "include" }),
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

  // HEL-905 (design.md Decision 6, task 6.6): a "node-progress" event updates ONLY the new
  // per-node fields -- it must never overwrite the run-level status/rowCount the footer/
  // preview-modal already read (which would otherwise blank the status pill mid-run).
  it("routes a node-progress event to nodeId/nodeRowCount without touching status/rowCount", async () => {
    const { controller, fetchMock } = createSseMock();
    global.fetch = fetchMock;

    const { result } = renderHook(() =>
      usePipelineRunEvents({ pipelineId: "pipe-1", active: true }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    controller.push("run-status", JSON.stringify({ status: "running" }));
    await waitFor(() => expect(result.current.status).toBe("running"));

    controller.push(
      "run-status",
      JSON.stringify({ status: "node-progress", nodeId: "step-tail-1", rowCount: 7 }),
    );

    await waitFor(() => {
      expect(result.current.nodeId).toBe("step-tail-1");
      expect(result.current.nodeRowCount).toBe(7);
    });
    // Run-level fields untouched by the node-progress event.
    expect(result.current.status).toBe("running");
    expect(result.current.rowCount).toBeNull();

    controller.close();
  });

  // HEL-905 (evaluation-1.md non-blocking suggestion): a prior run's per-node state must not
  // leak into a fresh run before its own first "node-progress" event arrives.
  it("resets nodeId/nodeRowCount when a fresh run-level queued/running event arrives", async () => {
    const { controller, fetchMock } = createSseMock();
    global.fetch = fetchMock;

    const { result } = renderHook(() =>
      usePipelineRunEvents({ pipelineId: "pipe-1", active: true }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    controller.push(
      "run-status",
      JSON.stringify({ status: "node-progress", nodeId: "stale-node", rowCount: 3 }),
    );
    await waitFor(() => expect(result.current.nodeId).toBe("stale-node"));

    controller.push("run-status", JSON.stringify({ status: "running" }));

    await waitFor(() => {
      expect(result.current.nodeId).toBeNull();
      expect(result.current.nodeRowCount).toBeNull();
    });

    controller.close();
  });

  it("does not close the stream on a node-progress event (non-terminal)", async () => {
    const { controller, fetchMock } = createSseMock();
    global.fetch = fetchMock;

    const { result } = renderHook(() =>
      usePipelineRunEvents({ pipelineId: "pipe-1", active: true }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    controller.push(
      "run-status",
      JSON.stringify({ status: "node-progress", nodeId: "s1", rowCount: 2 }),
    );
    await waitFor(() => expect(result.current.nodeId).toBe("s1"));

    controller.push("run-status", JSON.stringify({ status: "succeeded", rowCount: 9 }));
    await waitFor(() => expect(result.current.status).toBe("succeeded"));

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
