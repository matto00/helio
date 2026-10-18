import type { DraftPreviewLine, DraftPreviewRequest } from "../types/draftPreview";
import { createDraftPreviewScheduler } from "./draftPreviewScheduler";
import {
  chunkedResponse,
  ndjson,
  openResponse,
  requestTagged,
  tagOf,
  type OpenResponse,
} from "./draftPreviewTestSupport";

const rowsLine = (step: string) => ({
  type: "rows",
  step,
  available: true,
  rows: [],
  count: 0,
  truncated: false,
});

interface Harness {
  sends: Array<{ at: number; tag: string; signal: AbortSignal }>;
  lines: DraftPreviewLine[];
  errors: Error[];
  tooLarge: string[];
  limited: number[];
  respond: (r: Response | Promise<Response>) => void;
  scheduler: ReturnType<typeof createDraftPreviewScheduler>;
}

function harness(
  overrides: Partial<Parameters<typeof createDraftPreviewScheduler>[0]> = {},
): Harness {
  const h: Harness = {
    sends: [],
    lines: [],
    errors: [],
    tooLarge: [],
    limited: [],
    respond: () => undefined,
    scheduler: undefined as unknown as Harness["scheduler"],
  };
  let next: Response | Promise<Response> = chunkedResponse([ndjson(rowsLine("a"))]);
  h.respond = (r) => {
    next = r;
  };
  h.scheduler = createDraftPreviewScheduler({
    pipelineId: "p",
    onLine: (l) => h.lines.push(l),
    onError: (e) => h.errors.push(e),
    onTooLarge: (c) => h.tooLarge.push(c),
    onRateLimited: (ms) => h.limited.push(ms),
    send: (_id, request: DraftPreviewRequest, signal) => {
      h.sends.push({ at: Date.now(), tag: tagOf(request), signal });
      return Promise.resolve(next);
    },
    ...overrides,
  });
  return h;
}

const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe("createDraftPreviewScheduler", () => {
  beforeEach(() => jest.useFakeTimers({ now: 1_000_000 }));
  afterEach(() => jest.useRealTimers());

  it("sends 350 ms after the last change when edits are sparse", async () => {
    const h = harness();
    h.scheduler.update(requestTagged("one"));
    jest.advanceTimersByTime(349);
    expect(h.sends).toHaveLength(0);
    jest.advanceTimersByTime(1);
    expect(h.sends.map((s) => s.tag)).toEqual(["one"]);
    await settle();
    expect(h.lines).toHaveLength(1);
  });

  it("restarts the debounce on each change but never waits more than 600 ms from the first unsent one", () => {
    const h = harness();
    const t0 = Date.now();
    for (let i = 0; i < 10; i++) {
      h.scheduler.update(requestTagged(`e${i}`));
      jest.advanceTimersByTime(100);
    }
    jest.advanceTimersByTime(1);
    expect(h.sends).toHaveLength(1);
    expect(h.sends[0].at - t0).toBe(600);
    expect(h.sends[0].tag).toBe("e5"); // the state at the moment it fired, not the first one
  });

  it("never sends sooner than 600 ms after the previous send, and still sends the final state", () => {
    const h = harness();
    h.scheduler.update(requestTagged("a"));
    jest.advanceTimersByTime(350);
    const first = h.sends[0].at;
    h.scheduler.update(requestTagged("b"));
    jest.advanceTimersByTime(400);
    expect(h.sends).toHaveLength(1); // debounce is due at +350 but the floor holds it to +600
    jest.advanceTimersByTime(200);
    expect(h.sends.map((s) => s.tag)).toEqual(["a", "b"]);
    expect(h.sends[1].at - first).toBe(600);
  });

  it("aborts the in-flight request when the next one is sent, and drops its lines", async () => {
    const h = harness();
    const first = openResponse();
    h.respond(first.response);
    h.scheduler.update(requestTagged("first"));
    jest.advanceTimersByTime(350);
    await settle();
    first.push(ndjson(rowsLine("first")));
    await settle();
    expect(h.lines).toHaveLength(1);

    const second = openResponse();
    h.respond(second.response);
    h.scheduler.update(requestTagged("second"));
    jest.advanceTimersByTime(600);
    expect(h.sends[0].signal.aborted).toBe(true);
    expect(h.sends[1].signal.aborted).toBe(false);
    first.push(ndjson(rowsLine("stale")));
    second.push(ndjson(rowsLine("second")));
    await settle();
    expect(h.lines.map((l) => (l as { step: string }).step)).toEqual(["first", "second"]);
  });

  it("reports a request over a server cap, names the cap, and sends nothing", () => {
    const h = harness();
    const rows = Array.from({ length: 10_001 }, () => ({ a: 1 }));
    h.scheduler.update({ ...requestTagged("big"), roots: [{ id: "r", rows }] });
    jest.advanceTimersByTime(1000);
    expect(h.sends).toHaveLength(0);
    expect(h.tooLarge).toEqual(["a frame of more than 10000 rows"]);
  });

  it("holds sends for Retry-After after a 429, then sends the latest state", async () => {
    const h = harness();
    h.respond(chunkedResponse([], { status: 429, headers: { "Retry-After": "5" } }));
    h.scheduler.update(requestTagged("limited"));
    jest.advanceTimersByTime(350);
    await settle();
    expect(h.limited).toEqual([5000]);
    h.respond(chunkedResponse([ndjson(rowsLine("ok"))]));
    h.scheduler.update(requestTagged("newer"));
    jest.advanceTimersByTime(4000);
    expect(h.sends).toHaveLength(1);
    jest.advanceTimersByTime(1100);
    expect(h.sends.map((s) => s.tag)).toEqual(["limited", "newer"]);
  });

  it("re-sends the rejected state itself after Retry-After when nothing newer arrived", async () => {
    const h = harness();
    h.respond(chunkedResponse([], { status: 429, headers: { "Retry-After": "2" } }));
    h.scheduler.update(requestTagged("only"));
    jest.advanceTimersByTime(350);
    await settle();
    h.respond(chunkedResponse([]));
    jest.advanceTimersByTime(1900);
    expect(h.sends).toHaveLength(1);
    jest.advanceTimersByTime(200);
    expect(h.sends.map((s) => s.tag)).toEqual(["only", "only"]);
  });

  it("reports a failed stream through onError", async () => {
    const h = harness();
    h.respond(chunkedResponse([], { status: 500 }));
    h.scheduler.update(requestTagged("x"));
    jest.advanceTimersByTime(350);
    await settle();
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0].message).toMatch(/status 500/);
  });

  it("is inert after dispose: no pending send fires and the in-flight request is aborted", async () => {
    const h = harness();
    const open: OpenResponse = openResponse();
    h.respond(open.response);
    h.scheduler.update(requestTagged("a"));
    jest.advanceTimersByTime(350);
    h.scheduler.update(requestTagged("b"));
    h.scheduler.dispose();
    jest.advanceTimersByTime(5000);
    expect(h.sends).toHaveLength(1);
    expect(h.sends[0].signal.aborted).toBe(true);
    h.scheduler.update(requestTagged("c"));
    jest.advanceTimersByTime(5000);
    expect(h.sends).toHaveLength(1);
  });
});
