import { pipeline, run, iso } from "../test/homeFixtures";
import { formatClock } from "./timelineScale";
import { buildMarks, disclosureLabel, markLabel, nextMarkPosition } from "./timelineMarks";

describe("timelineMarks", () => {
  const p = pipeline({
    pipelineId: "p1",
    name: "orders-sync",
    runs: [
      run({
        runId: "r2",
        startedAt: iso(-1),
        status: "failed",
        errorLog: "source returned 0 rows\nat step 2",
      }),
      run({ runId: "r1", startedAt: iso(-5) }),
    ],
    upcoming: [iso(1), iso(2)],
  });

  it("orders runs and fires ascending by time", () => {
    expect(buildMarks(p).map((m) => m.status)).toEqual([
      "succeeded",
      "failed",
      "scheduled",
      "scheduled",
    ]);
  });

  it("labels a failed run with name, status, local time and the first error line", () => {
    const failed = buildMarks(p)[1];
    expect(markLabel("orders-sync", failed)).toBe(
      `orders-sync, failed, ${formatClock(failed.time)}, source returned 0 rows`,
    );
  });

  it("labels a scheduled fire without an error", () => {
    const fire = buildMarks(p)[2];
    expect(markLabel("orders-sync", fire)).toBe(
      `orders-sync, scheduled, ${formatClock(fire.time)}`,
    );
  });

  it("summarises a pipeline for the single-control row", () => {
    expect(disclosureLabel(p)).toBe(
      `orders-sync, 2 runs, 1 failed, next ${formatClock(Date.parse(iso(1)))}`,
    );
    expect(disclosureLabel(pipeline({ pipelineId: "q", name: "idle" }))).toBe(
      "idle, 0 runs, none failed, nothing scheduled",
    );
  });

  describe("nextMarkPosition", () => {
    const rows = [
      buildMarks(p),
      [],
      buildMarks(
        pipeline({
          pipelineId: "p2",
          name: "b",
          runs: [
            run({ runId: "x", startedAt: iso(-4.9) }),
            run({ runId: "y", startedAt: iso(-1.1) }),
          ],
        }),
      ),
    ];

    it("moves Left/Right within a row and stops at the edges", () => {
      expect(nextMarkPosition(rows, { row: 0, col: 1 }, "ArrowRight")).toEqual({ row: 0, col: 2 });
      expect(nextMarkPosition(rows, { row: 0, col: 0 }, "ArrowLeft")).toBeNull();
      expect(nextMarkPosition(rows, { row: 0, col: 3 }, "ArrowRight")).toBeNull();
    });

    it("jumps with Home and End", () => {
      expect(nextMarkPosition(rows, { row: 0, col: 2 }, "Home")).toEqual({ row: 0, col: 0 });
      expect(nextMarkPosition(rows, { row: 0, col: 1 }, "End")).toEqual({ row: 0, col: 3 });
    });

    it("moves Up/Down to the nearest-in-time mark of the next row that has marks", () => {
      expect(nextMarkPosition(rows, { row: 0, col: 1 }, "ArrowDown")).toEqual({ row: 2, col: 1 });
      expect(nextMarkPosition(rows, { row: 0, col: 0 }, "ArrowDown")).toEqual({ row: 2, col: 0 });
      expect(nextMarkPosition(rows, { row: 2, col: 1 }, "ArrowUp")).toEqual({ row: 0, col: 1 });
      expect(nextMarkPosition(rows, { row: 0, col: 0 }, "ArrowUp")).toBeNull();
    });

    it("ignores other keys", () => {
      expect(nextMarkPosition(rows, { row: 0, col: 0 }, "a")).toBeNull();
    });
  });
});
