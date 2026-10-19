import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { createDraftPreviewScheduler } from "./draftPreviewScheduler";
import { chunkedResponse, requestTagged, tagOf } from "./draftPreviewTestSupport";

// HEL-1630 task 5.12 / design.md D8: a simulated drag against the real scheduler under fake timers. The numbers are counted
// from the scheduler's own `send` seam, never derived from its settings. `HEL1630_EVIDENCE_DIR`, when set, receives the counts.

const DRAG_MS = 60_000;

interface Sent {
  at: number;
  tag: string;
}

function simulate(edits: (emit: (tag: string) => void, t: number) => void): {
  sent: Sent[];
  lastTag: string;
} {
  jest.useFakeTimers({ now: 5_000_000 });
  const sent: Sent[] = [];
  const scheduler = createDraftPreviewScheduler({
    pipelineId: "p",
    onLine: () => undefined,
    send: (_id, request) => {
      sent.push({ at: Date.now(), tag: tagOf(request) });
      return Promise.resolve(chunkedResponse([]));
    },
  });
  const start = Date.now();
  let n = 0;
  let lastTag = "";
  const emit = (tag: string) => {
    lastTag = tag;
    scheduler.update(requestTagged(tag));
    n += 1;
  };
  for (let t = 0; t < DRAG_MS; t += 16) {
    edits(emit, t);
    jest.advanceTimersByTime(16);
  }
  const duringDrag = sent.filter((s) => s.at - start <= DRAG_MS);
  jest.advanceTimersByTime(3_000); // the drag has ended: whatever is pending must still go out
  scheduler.dispose();
  jest.useRealTimers();
  expect(n).toBeGreaterThan(0);
  record({ simulatedEdits: n, sendsDuringDrag: duringDrag.length, sendsTotal: sent.length });
  return { sent: sent.map((s) => ({ at: s.at - start, tag: s.tag })), lastTag };
}

const recorded: Record<string, unknown>[] = [];
function record(entry: Record<string, unknown>): void {
  recorded.push(entry);
}

const gaps = (sent: Sent[]): number[] => sent.slice(1).map((s, i) => s.at - sent[i].at);

afterAll(() => {
  const dir = process.env.HEL1630_EVIDENCE_DIR;
  if (dir) writeFileSync(join(dir, "drag-counts.json"), JSON.stringify(recorded, null, 2) + "\n");
});

describe("a simulated drag", () => {
  afterEach(() => jest.useRealTimers());

  it("an edit every 16 ms for 60 s sends 90 to 100 requests, never closer than 600 ms, and finishes on the final state", () => {
    const { sent, lastTag } = simulate((emit, t) => emit(`drag-${t}`));
    const duringDrag = sent.filter((s) => s.at <= DRAG_MS);
    record({
      scenario: "continuous drag",
      sendsDuringDrag: duringDrag.length,
      minGapMs: Math.min(...gaps(sent)),
    });
    expect(duringDrag.length).toBeGreaterThanOrEqual(90);
    expect(duringDrag.length).toBeLessThanOrEqual(100);
    expect(Math.min(...gaps(sent))).toBeGreaterThanOrEqual(600);
    expect(sent[sent.length - 1].tag).toBe(lastTag);
  });

  it("40 ms bursts of edits every 16 ms separated by 360 ms of quiet for 60 s never send closer than 600 ms", () => {
    const { sent, lastTag } = simulate((emit, t) => {
      if (t % 400 < 40) emit(`burst-${t}`);
    });
    // Debounce alone would fire ~350 ms after each burst, every 400 ms: about 150 a minute.
    record({
      scenario: "bursts",
      sendsDuringDrag: sent.filter((s) => s.at <= DRAG_MS).length,
      minGapMs: Math.min(...gaps(sent)),
    });
    expect(Math.min(...gaps(sent))).toBeGreaterThanOrEqual(600);
    expect(sent.filter((s) => s.at <= DRAG_MS).length).toBeLessThanOrEqual(100);
    expect(sent[sent.length - 1].tag).toBe(lastTag);
  });
});
