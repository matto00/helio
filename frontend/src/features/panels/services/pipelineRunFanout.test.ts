import { computeRetryDelayMs, subscribeToPipelineSucceeded } from "./pipelineRunFanout";

interface MockConnection {
  push: (eventName: string, data: string) => void;
  close: () => void;
}

/** Mirrors `usePipelineRunEvents.test.ts`'s SSE mock, generalized to record every `fetch` call
 *  as its own connection (this manager may open several over a test — one per pipeline, plus
 *  reconnects/retries) rather than assuming exactly one. */
function createFetchMock(options: { ok?: boolean; contentType?: string } = {}): {
  fetchMock: jest.Mock;
  connections: MockConnection[];
} {
  const { ok = true, contentType = "text/event-stream; charset=UTF-8" } = options;
  const connections: MockConnection[] = [];
  const encoder = new TextEncoder();

  const fetchMock = jest.fn(() => {
    let enqueue: (chunk: Uint8Array) => void = () => undefined;
    let closeStream: () => void = () => undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        enqueue = (chunk) => ctrl.enqueue(chunk);
        closeStream = () => ctrl.close();
      },
    });

    // Plain object instead of `new Response(...)` — jsdom doesn't expose the global
    // Response constructor in the test environment (same workaround as the sibling hook test).
    const response = {
      ok,
      status: ok ? 200 : 401,
      headers: {
        get: (name: string) => (name.toLowerCase() === "content-type" ? contentType : null),
      },
      body: stream,
    } as unknown as Response;

    connections.push({
      push(eventName: string, data: string) {
        enqueue(encoder.encode(`event: ${eventName}\ndata: ${data}\n\n`));
      },
      close() {
        try {
          closeStream();
        } catch {
          /* already closed by the manager on a terminal event */
        }
      },
    });

    return Promise.resolve(response);
  });

  return { fetchMock, connections };
}

let originalFetch: typeof global.fetch;

beforeEach(() => {
  originalFetch = global.fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.useRealTimers();
});

describe("computeRetryDelayMs", () => {
  it("doubles from 1s and caps at 30s", () => {
    expect(computeRetryDelayMs(0)).toBe(1000);
    expect(computeRetryDelayMs(1)).toBe(2000);
    expect(computeRetryDelayMs(2)).toBe(4000);
    expect(computeRetryDelayMs(3)).toBe(8000);
    expect(computeRetryDelayMs(4)).toBe(16000);
    expect(computeRetryDelayMs(5)).toBe(30000);
    expect(computeRetryDelayMs(10)).toBe(30000);
  });
});

describe("subscribeToPipelineSucceeded — one connection per pipelineId (task 1.1)", () => {
  it("opens exactly one fetch for two concurrent subscribers to the same pipelineId", async () => {
    const { fetchMock } = createFetchMock();
    global.fetch = fetchMock;

    const listener1 = jest.fn();
    const listener2 = jest.fn();
    const unsubscribe1 = subscribeToPipelineSucceeded("pipe-1-1", listener1);
    const unsubscribe2 = subscribeToPipelineSucceeded("pipe-1-1", listener2);

    await Promise.resolve();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/pipelines/pipe-1-1/run-events",
      expect.objectContaining({ credentials: "include" }),
    );

    unsubscribe1();
    unsubscribe2();
  });
});

describe("subscribeToPipelineSucceeded — closes on last unsubscribe (task 1.2)", () => {
  it("aborts the connection and stops fetching once the last listener unsubscribes", async () => {
    const { fetchMock } = createFetchMock();
    global.fetch = fetchMock;

    const listener1 = jest.fn();
    const listener2 = jest.fn();
    const unsubscribe1 = subscribeToPipelineSucceeded("pipe-1-2", listener1);
    const unsubscribe2 = subscribeToPipelineSucceeded("pipe-1-2", listener2);

    await Promise.resolve();
    await Promise.resolve();

    const signal = (fetchMock.mock.calls[0] as [string, { signal: AbortSignal }])[1].signal;
    expect(signal.aborted).toBe(false);

    unsubscribe1();
    // One listener remains — connection must stay open.
    expect(signal.aborted).toBe(false);

    unsubscribe2();
    expect(signal.aborted).toBe(true);

    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("subscribeToPipelineSucceeded — reconnect after terminal status (task 1.3)", () => {
  it("reconnects after a succeeded event while a listener remains subscribed", async () => {
    const { fetchMock, connections } = createFetchMock();
    global.fetch = fetchMock;

    const listener = jest.fn();
    const unsubscribe = subscribeToPipelineSucceeded("pipe-1-3", listener);

    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    connections[0].push("run-status", JSON.stringify({ status: "succeeded", rowCount: 1 }));

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it("stops reconnecting once all listeners have unsubscribed", async () => {
    const { fetchMock, connections } = createFetchMock();
    global.fetch = fetchMock;

    const listener = jest.fn();
    const unsubscribe = subscribeToPipelineSucceeded("pipe-1-3b", listener);

    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    unsubscribe();
    connections[0].push("run-status", JSON.stringify({ status: "succeeded", rowCount: 1 }));

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // No reconnect — the last listener unsubscribed before the terminal event arrived.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("subscribeToPipelineSucceeded — bounded backoff retry (task 1.4, design.md D6)", () => {
  it("retries once after the computed delay on a non-2xx connect failure, then resets on success", async () => {
    jest.useFakeTimers();

    const failing = createFetchMock({ ok: false, contentType: "application/json" });
    global.fetch = failing.fetchMock;

    const listener = jest.fn();
    const unsubscribe = subscribeToPipelineSucceeded("pipe-1-4", listener);

    await jest.advanceTimersByTimeAsync(0);
    expect(failing.fetchMock).toHaveBeenCalledTimes(1);

    // computeRetryDelayMs(0) === 1000ms — no retry before that.
    await jest.advanceTimersByTimeAsync(999);
    expect(failing.fetchMock).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1);
    expect(failing.fetchMock).toHaveBeenCalledTimes(2);

    unsubscribe();
  });

  it("resets the attempt counter to 0 once a connection succeeds", async () => {
    jest.useFakeTimers();

    let callCount = 0;
    const succeeding = createFetchMock();
    global.fetch = jest.fn((...args: Parameters<typeof fetch>) => {
      callCount += 1;
      if (callCount === 1) {
        // First attempt: non-2xx connect failure.
        return Promise.resolve({
          ok: false,
          status: 500,
          headers: { get: () => "application/json" },
          body: null,
        } as unknown as Response);
      }
      return succeeding.fetchMock(...args) as ReturnType<typeof fetch>;
    });

    const listener = jest.fn();
    const unsubscribe = subscribeToPipelineSucceeded("pipe-1-4b", listener);

    await jest.advanceTimersByTimeAsync(0);
    expect(callCount).toBe(1);

    // computeRetryDelayMs(0) === 1000ms for the first retry.
    await jest.advanceTimersByTimeAsync(1000);
    expect(callCount).toBe(2);
    expect(succeeding.connections).toHaveLength(1);

    // Simulate a second, later connection failure on the now-open connection ending
    // without a terminal event — if the attempt counter had NOT reset to 0 after the
    // success above, this retry would be scheduled at computeRetryDelayMs(1) = 2000ms
    // rather than computeRetryDelayMs(0) = 1000ms.
    succeeding.connections[0].close();
    await jest.advanceTimersByTimeAsync(999);
    expect(callCount).toBe(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(callCount).toBe(3);

    unsubscribe();
  });
});

describe("subscribeToPipelineSucceeded — fan-out to multiple listeners (task 3.1, C5)", () => {
  it("delivers succeeded to two panels bound to the SAME pipeline from one connection", async () => {
    const { fetchMock, connections } = createFetchMock();
    global.fetch = fetchMock;

    const panelAListener = jest.fn();
    const panelBListener = jest.fn();
    const unsubscribeA = subscribeToPipelineSucceeded("pipe-3-1", panelAListener);
    const unsubscribeB = subscribeToPipelineSucceeded("pipe-3-1", panelBListener);

    await Promise.resolve();
    await Promise.resolve();

    // At no point were two concurrent SSE connections open for this pipeline.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    connections[0].push("run-status", JSON.stringify({ status: "succeeded", rowCount: 3 }));

    await Promise.resolve();
    await Promise.resolve();

    expect(panelAListener).toHaveBeenCalledTimes(1);
    expect(panelBListener).toHaveBeenCalledTimes(1);

    unsubscribeA();
    unsubscribeB();
  });
});

describe("subscribeToPipelineSucceeded — scoped refetch only (task 3.2, C6)", () => {
  it("does not call a listener for a different pipelineId when an unrelated pipeline succeeds", async () => {
    const { fetchMock, connections } = createFetchMock();
    global.fetch = fetchMock;

    const listenerA = jest.fn();
    const listenerB = jest.fn();
    const unsubscribeA = subscribeToPipelineSucceeded("pipe-3-2-a", listenerA);
    const unsubscribeB = subscribeToPipelineSucceeded("pipe-3-2-b", listenerB);

    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Only pipeline A succeeds.
    connections[0].push("run-status", JSON.stringify({ status: "succeeded", rowCount: 1 }));

    await Promise.resolve();
    await Promise.resolve();

    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).not.toHaveBeenCalled();

    unsubscribeA();
    unsubscribeB();
  });

  it("does not call a listener when its watched pipeline fails rather than succeeds", async () => {
    const { fetchMock, connections } = createFetchMock();
    global.fetch = fetchMock;

    const listener = jest.fn();
    const unsubscribe = subscribeToPipelineSucceeded("pipe-3-2-c", listener);

    await Promise.resolve();
    await Promise.resolve();

    connections[0].push("run-status", JSON.stringify({ status: "failed", errorLog: "boom" }));

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(listener).not.toHaveBeenCalled();
    // A failed run is still terminal — the manager reconnects to catch the next run (D3).
    expect(fetchMock).toHaveBeenCalledTimes(2);

    unsubscribe();
  });
});
