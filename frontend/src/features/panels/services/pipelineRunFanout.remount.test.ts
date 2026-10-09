import { currentGeneration, registerOutputPipeline } from "../state/outputFreshness";
import { hasRunBaseline, subscribeToPipelineSucceeded } from "./pipelineRunFanout";
import { resetOutputFreshness } from "../state/outputFreshness";

// HEL-1392 design.md D5 -- the last terminal run id observed per pipeline outlives the shared
// connection, so a run that finished while no card was subscribed is noticed on reconnect, and a
// pipeline whose latest run was never seen to finish has no baseline for row reuse to rely on.

type Latest = { id: string; status: string } | null;

function mockFetch(latest: Latest[]): void {
  let call = 0;
  global.fetch = jest.fn((url: unknown, init?: { signal?: AbortSignal }) => {
    if (typeof url === "string" && url.includes("/runs/latest")) {
      const fixture = latest[call++] ?? null;
      return Promise.resolve(
        fixture
          ? ({ ok: true, status: 200, json: () => Promise.resolve(fixture) } as Response)
          : ({ ok: false, status: 404, json: () => Promise.resolve({}) } as Response),
      );
    }
    // `run-events`: a stream that never produces anything until the manager aborts it.
    return new Promise((_, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
      );
    });
  }) as unknown as typeof fetch;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

let originalFetch: typeof global.fetch;
beforeEach(() => {
  originalFetch = global.fetch;
});
afterEach(() => {
  global.fetch = originalFetch;
});

describe("pipelineRunFanout run baseline across a resubscribe (HEL-1392)", () => {
  it("notifies a resubscriber about a run that finished while nobody was subscribed", async () => {
    mockFetch([
      { id: "run-1", status: "succeeded" },
      { id: "run-2", status: "succeeded" },
    ]);
    registerOutputPipeline("out-A", "pipe-A");
    const first = jest.fn();
    const unsubscribe = subscribeToPipelineSucceeded("pipe-A", first);
    await flush();
    expect(hasRunBaseline("pipe-A")).toBe(true);
    expect(first).not.toHaveBeenCalled();
    unsubscribe();

    const generation = currentGeneration("out-A");
    const second = jest.fn();
    const unsubscribeSecond = subscribeToPipelineSucceeded("pipe-A", second);
    await flush();

    expect(second).toHaveBeenCalledTimes(1);
    expect(currentGeneration("out-A")).toBeGreaterThan(generation);
    unsubscribeSecond();
  });

  it("does not notify, or invalidate, when the resubscriber sees the run it already knew", async () => {
    mockFetch([
      { id: "run-1", status: "succeeded" },
      { id: "run-1", status: "succeeded" },
    ]);
    registerOutputPipeline("out-B", "pipe-B");
    const unsubscribe = subscribeToPipelineSucceeded("pipe-B", jest.fn());
    await flush();
    unsubscribe();
    const generation = currentGeneration("out-B");
    const second = jest.fn();
    const unsubscribeSecond = subscribeToPipelineSucceeded("pipe-B", second);
    await flush();
    expect(second).not.toHaveBeenCalled();
    expect(currentGeneration("out-B")).toBe(generation);
    unsubscribeSecond();
  });

  it.each([
    ["latest run still running", [{ id: "run-1", status: "running" }]],
    ["pipeline has never run", [null]],
  ] as [string, Latest[]][])("records no baseline when the %s", async (_name, latest) => {
    mockFetch(latest);
    const unsubscribe = subscribeToPipelineSucceeded(`pipe-${_name}`, jest.fn());
    await flush();
    expect(hasRunBaseline(`pipe-${_name}`)).toBe(false);
    unsubscribe();
  });

  it("records no baseline when runs/latest fails", async () => {
    global.fetch = jest.fn((url: unknown, init?: { signal?: AbortSignal }) => {
      if (typeof url === "string" && url.includes("/runs/latest")) {
        return Promise.reject(new Error("network down"));
      }
      return new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        );
      });
    }) as unknown as typeof fetch;
    const unsubscribe = subscribeToPipelineSucceeded("pipe-failed-latest", jest.fn());
    await flush();
    expect(hasRunBaseline("pipe-failed-latest")).toBe(false);
    unsubscribe();
  });

  it("forgets every recorded run id when the freshness state is reset (logout)", async () => {
    mockFetch([{ id: "run-1", status: "succeeded" }]);
    const unsubscribe = subscribeToPipelineSucceeded("pipe-reset", jest.fn());
    await flush();
    expect(hasRunBaseline("pipe-reset")).toBe(true);
    unsubscribe();
    resetOutputFreshness();
    expect(hasRunBaseline("pipe-reset")).toBe(false);
  });

  it("a live succeeded event invalidates the pipeline's Outputs", async () => {
    const encoder = new TextEncoder();
    let push: (chunk: string) => void = () => undefined;
    global.fetch = jest.fn((url: unknown) => {
      if (typeof url === "string" && url.includes("/runs/latest")) {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: () => Promise.resolve({}),
        } as Response);
      }
      const stream = new ReadableStream<Uint8Array>({
        start(ctrl) {
          push = (chunk) => ctrl.enqueue(encoder.encode(chunk));
        },
      });
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => "text/event-stream" },
        body: stream,
      } as unknown as Response);
    }) as unknown as typeof fetch;
    registerOutputPipeline("out-live", "pipe-live");
    const listener = jest.fn();
    const unsubscribe = subscribeToPipelineSucceeded("pipe-live", listener);
    await flush();
    const generation = currentGeneration("out-live");
    push('event: run-status\ndata: {"status":"succeeded","runId":"live-1"}\n\n');
    await flush();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(currentGeneration("out-live")).toBeGreaterThan(generation);
    unsubscribe();
  });
});
