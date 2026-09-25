import { computeRetryDelayMs, subscribeToPipelineSucceeded } from "./pipelineRunFanout";

interface MockConnection {
  push: (eventName: string, data: string) => void;
  close: () => void;
}

/** HEL-1174: one fixture per `runs/latest` reconcile call this pipeline's `connect()` makes,
 *  consumed in order by call index; `null` (or running past the end of the array) means "no runs
 *  yet" (404) for that specific call. Absent entirely (the default) means every reconcile call
 *  sees 404. */
interface LatestRunFixture {
  id: string;
  status: "succeeded" | "failed" | "dry_run" | "queued" | "running";
  rowCount?: number;
}

/** Mirrors `usePipelineRunEvents.test.ts`'s SSE mock, generalized to record every `/run-events`
 *  `fetch` call as its own connection (this manager may open several over a test — one per
 *  pipeline, plus reconnects/retries) rather than assuming exactly one.
 *
 *  HEL-1174: also routes `/runs/latest` calls (the reconcile-on-connect fetch every `connect()`
 *  now issues BEFORE its `/run-events` call) to a SEPARATE, configurable responder driven by
 *  `latestRuns` — defaulting to "no runs yet" (404) so every pre-existing test's SSE-only
 *  assertions keep working unchanged aside from the doubled total call count (one reconcile call
 *  plus one SSE call per `connect()` attempt now, not one). */
function createFetchMock(
  options: { ok?: boolean; contentType?: string; latestRuns?: Array<LatestRunFixture | null> } = {},
): {
  fetchMock: jest.Mock;
  connections: MockConnection[];
} {
  const { ok = true, contentType = "text/event-stream; charset=UTF-8", latestRuns = [] } = options;
  const connections: MockConnection[] = [];
  const encoder = new TextEncoder();
  let latestRunCallIndex = 0;

  const fetchMock = jest.fn((url: unknown) => {
    if (typeof url === "string" && url.includes("/runs/latest")) {
      const fixture = latestRuns[latestRunCallIndex] ?? undefined;
      latestRunCallIndex += 1;
      if (!fixture) {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: () => Promise.resolve({}),
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ id: fixture.id, status: fixture.status, rowCount: fixture.rowCount }),
      } as unknown as Response);
    }

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

/** HEL-1174: `connect()` now awaits `reconcile()` (its own `fetch` + `.json()` round trip) before
 *  its `run-events` `fetch` call, one more microtask hop than before this ticket. Flushing a
 *  generous, fixed number of microtasks (rather than counting the exact chain length, which would
 *  be brittle to the next internal `await` this file adds) is deterministic here — no fake timers
 *  or real I/O are involved, only already-resolved `Promise.resolve(...)` mocks settling. */
async function flushMicrotasks(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

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

    await flushMicrotasks();

    // HEL-1174: one reconcile call (runs/latest) plus one SSE call (run-events) per connect().
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/pipelines/pipe-1-1/run-events",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/pipelines/pipe-1-1/runs/latest",
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

    await flushMicrotasks();

    // HEL-1174: calls[0] is the reconcile call — it shares the SAME AbortController/signal as
    // the SSE call that follows it, so asserting against it still proves the whole connect()
    // attempt (both fetches) is aborted together.
    const signal = (fetchMock.mock.calls[0] as [string, { signal: AbortSignal }])[1].signal;
    expect(signal.aborted).toBe(false);

    unsubscribe1();
    // One listener remains — connection must stay open.
    expect(signal.aborted).toBe(false);

    unsubscribe2();
    expect(signal.aborted).toBe(true);

    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("subscribeToPipelineSucceeded — reconnect after terminal status (task 1.3)", () => {
  it("reconnects after a succeeded event while a listener remains subscribed", async () => {
    const { fetchMock, connections } = createFetchMock();
    global.fetch = fetchMock;

    const listener = jest.fn();
    const unsubscribe = subscribeToPipelineSucceeded("pipe-1-3", listener);

    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    connections[0].push("run-status", JSON.stringify({ status: "succeeded", rowCount: 1 }));

    await flushMicrotasks();

    // A second connect() attempt (reconcile + SSE) fired on reconnect.
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it("stops reconnecting once all listeners have unsubscribed", async () => {
    const { fetchMock, connections } = createFetchMock();
    global.fetch = fetchMock;

    const listener = jest.fn();
    const unsubscribe = subscribeToPipelineSucceeded("pipe-1-3b", listener);

    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    unsubscribe();
    connections[0].push("run-status", JSON.stringify({ status: "succeeded", rowCount: 1 }));

    await flushMicrotasks();

    // No reconnect — the last listener unsubscribed before the terminal event arrived.
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
    // One reconcile call (no-op 404) plus one failing SSE call.
    expect(failing.fetchMock).toHaveBeenCalledTimes(2);

    // computeRetryDelayMs(0) === 1000ms — no retry before that.
    await jest.advanceTimersByTimeAsync(999);
    expect(failing.fetchMock).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(1);
    expect(failing.fetchMock).toHaveBeenCalledTimes(4);

    unsubscribe();
  });

  it("resets the attempt counter to 0 once a connection succeeds", async () => {
    jest.useFakeTimers();

    let sseCallCount = 0;
    const succeeding = createFetchMock();
    global.fetch = jest.fn((...args: Parameters<typeof fetch>) => {
      const [url] = args;
      if (typeof url === "string" && url.includes("/runs/latest")) {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: () => Promise.resolve({}),
        } as unknown as Response);
      }
      sseCallCount += 1;
      if (sseCallCount === 1) {
        // First SSE attempt: non-2xx connect failure.
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
    expect(sseCallCount).toBe(1);

    // computeRetryDelayMs(0) === 1000ms for the first retry.
    await jest.advanceTimersByTimeAsync(1000);
    expect(sseCallCount).toBe(2);
    expect(succeeding.connections).toHaveLength(1);

    // Simulate a second, later connection failure on the now-open connection ending
    // without a terminal event — if the attempt counter had NOT reset to 0 after the
    // success above, this retry would be scheduled at computeRetryDelayMs(1) = 2000ms
    // rather than computeRetryDelayMs(0) = 1000ms.
    succeeding.connections[0].close();
    await jest.advanceTimersByTimeAsync(999);
    expect(sseCallCount).toBe(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(sseCallCount).toBe(3);

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

    await flushMicrotasks();

    // At no point were two concurrent SSE connections open for this pipeline.
    expect(fetchMock).toHaveBeenCalledTimes(2);

    connections[0].push("run-status", JSON.stringify({ status: "succeeded", rowCount: 3 }));

    await flushMicrotasks();

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

    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // Only pipeline A succeeds.
    connections[0].push("run-status", JSON.stringify({ status: "succeeded", rowCount: 1 }));

    await flushMicrotasks();

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

    await flushMicrotasks();

    connections[0].push("run-status", JSON.stringify({ status: "failed", errorLog: "boom" }));

    await flushMicrotasks();

    expect(listener).not.toHaveBeenCalled();
    // A failed run is still terminal — the manager reconnects to catch the next run (D3).
    // Two connect() attempts total (initial + reconnect), each reconcile + SSE.
    expect(fetchMock).toHaveBeenCalledTimes(4);

    unsubscribe();
  });
});

// HEL-1174 (design.md Decisions 2-3, tasks.md 3.1/4.1): the reconcile-on-connect fallback this
// ticket adds. "reconnect gap regression" below is the deterministic unit-level proof required by
// AC bullet 3 — RED before this file's `reconcile()`/`lastObservedRunId` wiring existed (a run
// completing entirely inside the reconnect gap was unobservable — see probe 1 in
// `SseReconnectGapProbeSpec.scala` for the backend-level equivalent), GREEN after.
describe("subscribeToPipelineSucceeded — reconcile-on-connect (HEL-1174, design.md Decisions 2-3)", () => {
  // Probe-confirmed against the real e2e (see files-modified.md): the very FIRST connect a
  // subscriber ever makes must establish reconcile's baseline WITHOUT firing, even when the
  // pipeline's latest run is already succeeded — the panel's own initial data fetch already
  // reflects it, and firing here too broke hel1094-sse-fan-out-panel-refresh.spec.ts's "status
  // region is empty before any fan-out-triggered refresh" assertion when measured live.
  it("does not fire on the very first connect, even when the pipeline's latest run is already succeeded", async () => {
    const { fetchMock, connections } = createFetchMock({
      latestRuns: [{ id: "run-already-done", status: "succeeded", rowCount: 5 }],
    });
    global.fetch = fetchMock;

    const listener = jest.fn();
    const unsubscribe = subscribeToPipelineSucceeded("pipe-4-1", listener);

    await flushMicrotasks();

    expect(listener).not.toHaveBeenCalled();
    expect(connections).toHaveLength(1);

    unsubscribe();
  });

  // HEL-1174 (skeptic-final-1.md, Change Request 1) — RED before this fix: a panel/dashboard
  // mount racing an in-flight run (queued/running, not yet terminal) previously adopted that
  // run's id as "already observed" from the reconcile call alone, so the SAME run's terminal
  // `succeeded` event arriving moments later on the live SSE path was silently deduped away and
  // the listener never fired. This is reachable on every ordinary page load that happens to
  // coincide with an in-flight run (auto-run tick, form-submit debounce, or manual run) — a wider
  // window than the reconnect race this ticket originally targeted, and the exact class of bug
  // ("a form/counter works once and then, intermittently, downstream charts silently stop
  // refreshing") this ticket exists to close.
  it("fires when a run that was in-flight (queued) at mount time later succeeds via the live SSE path, with the SAME run id", async () => {
    const { fetchMock, connections } = createFetchMock({
      latestRuns: [{ id: "run-inflight", status: "queued" }],
    });
    global.fetch = fetchMock;

    const listener = jest.fn();
    const unsubscribe = subscribeToPipelineSucceeded("pipe-4-6", listener);

    await flushMicrotasks();
    // The in-flight run's "queued" status must not be adopted as an observed baseline.
    expect(listener).not.toHaveBeenCalled();

    // The SAME run later reaches its terminal outcome, delivered on the live SSE path this
    // connect() already opened.
    connections[0].push(
      "run-status",
      JSON.stringify({ status: "succeeded", rowCount: 1, runId: "run-inflight" }),
    );

    await flushMicrotasks();

    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it("HEL-1174 regression: a run completing entirely during the reconnect gap is still observed via reconcile-on-connect", async () => {
    // First connect(): no runs yet (404) -- the live SSE stream delivers the FIRST run's
    // succeeded event instead, mirroring the e2e's first form submit.
    // Second connect() (the D3 post-terminal reconnect): runs/latest now reports a SECOND run,
    // "run-2", already succeeded -- simulating it completing entirely inside the gap between the
    // first stream's terminal-triggered close and this second connect()'s SSE subscribe
    // registering, exactly the structural gap probe 1 in SseReconnectGapProbeSpec.scala
    // demonstrates at the registry level. The second SSE connection's mock never pushes anything
    // for run-2 -- if this test passes, it is PURELY because of the reconcile call, not because
    // the live channel happened to catch it.
    const { fetchMock, connections } = createFetchMock({
      latestRuns: [null, { id: "run-2", status: "succeeded", rowCount: 2 }],
    });
    global.fetch = fetchMock;

    const listener = jest.fn();
    const unsubscribe = subscribeToPipelineSucceeded("pipe-4-2", listener);

    await flushMicrotasks();
    expect(connections).toHaveLength(1);

    connections[0].push(
      "run-status",
      JSON.stringify({ status: "succeeded", rowCount: 1, runId: "run-1" }),
    );

    await flushMicrotasks();

    expect(connections).toHaveLength(2);
    // Once for run-1 (live SSE), once for run-2 (reconcile-on-connect alone).
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
  });

  it("a run id already observed via a live SSE event is not re-fired when the following reconcile call redundantly reports the same id", async () => {
    // First connect(): no runs yet -- the live SSE stream delivers run-1's succeeded event,
    // firing once and establishing the baseline (lastObservedRunId = "run-1").
    // Second connect() (the D3 post-terminal reconnect): reconcile reports run-1 AGAIN (e.g. it
    // was still the latest row at the moment this reconcile call raced the reconnect) — a
    // genuine dedup case now that a baseline already exists, unlike the very-first-connect case
    // above.
    const { fetchMock, connections } = createFetchMock({
      latestRuns: [null, { id: "run-1", status: "succeeded", rowCount: 1 }],
    });
    global.fetch = fetchMock;

    const listener = jest.fn();
    const unsubscribe = subscribeToPipelineSucceeded("pipe-4-3", listener);

    await flushMicrotasks();
    connections[0].push(
      "run-status",
      JSON.stringify({ status: "succeeded", rowCount: 1, runId: "run-1" }),
    );
    await flushMicrotasks();

    expect(connections).toHaveLength(2);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it("does not fire when a RECONNECT's reconcile call reports a NEW but non-succeeded (failed) run", async () => {
    // Establishes a real baseline first (live SSE succeeded for run-1), then the reconnect's
    // reconcile call reports a DIFFERENT id whose status is "failed" -- isolates "non-succeeded
    // status never fires" from the separate "first-connect never fires" rule above.
    const { fetchMock, connections } = createFetchMock({
      latestRuns: [null, { id: "run-2-failed", status: "failed" }],
    });
    global.fetch = fetchMock;

    const listener = jest.fn();
    const unsubscribe = subscribeToPipelineSucceeded("pipe-4-4", listener);

    await flushMicrotasks();
    connections[0].push(
      "run-status",
      JSON.stringify({ status: "succeeded", rowCount: 1, runId: "run-1" }),
    );
    await flushMicrotasks();

    expect(connections).toHaveLength(2);
    // Exactly once — from the live run-1 event only, not from run-2-failed's reconcile.
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it("does not fire when reconcile reports 404 (pipeline has never run)", async () => {
    const { fetchMock } = createFetchMock();
    global.fetch = fetchMock;

    const listener = jest.fn();
    const unsubscribe = subscribeToPipelineSucceeded("pipe-4-5", listener);

    await flushMicrotasks();

    expect(listener).not.toHaveBeenCalled();

    unsubscribe();
  });
});
