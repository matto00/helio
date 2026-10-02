/** HEL-1069 -- zero-row warnings (specs/mcp-run-pipeline-step-counts). */

import { computeRunWarnings } from "./runWarnings.js";
import type { PipelineStepResponse } from "./types.js";

const step = (
  id: string,
  type: string,
  parentStepId?: string,
  rootId?: string,
  config: unknown = {},
): PipelineStepResponse => ({ id, type, position: 0, config, parentStepId, rootId });

const run = (
  steps: PipelineStepResponse[],
  stepRowCounts: Record<string, number>,
  sourceRowCount = 10,
) => computeRunWarnings({ steps, stepRowCounts, sourceRowCount, primaryRootId: "r1" });

describe("computeRunWarnings", () => {
  it("warns on a zero-row join whose parent is non-empty, naming step, type and input count", () => {
    const steps = [step("a", "filter", undefined, "r1"), step("j", "join", "a")];
    const w = run(steps, { a: 5, j: 0 });
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ stepId: "j", type: "join", inputCounts: { parent: 5 } });
    expect(w[0]?.message).toContain("j");
  });

  it("warns when only the LANE input of a join is non-empty", () => {
    const steps = [
      step("a", "filter", undefined, "r1"),
      step("b", "filter", "a"),
      step("j", "join", "b", undefined, { secondaryInput: { kind: "lane", stepId: "lane1" } }),
      step("lane1", "aggregate", "a"),
    ];
    const w = run(steps, { a: 5, b: 0, j: 0, lane1: 3 });
    const joinWarning = w.find((x) => x.stepId === "j");
    expect(joinWarning?.inputCounts).toEqual({ lane: 3 });
  });

  it("a healthy run yields an empty warnings array", () => {
    const steps = [step("a", "filter", undefined, "r1"), step("b", "limit", "a")];
    expect(run(steps, { a: 5, b: 5 })).toEqual([]);
  });

  it("a root-level step of the primary root with zero rows from a non-empty source warns", () => {
    expect(run([step("a", "filter", undefined, "r1")], { a: 0 }, 7)).toHaveLength(1);
  });

  it("walks past a disabled parent (no count entry) to the nearest counted ancestor", () => {
    const steps = [
      step("a", "filter", undefined, "r1"),
      step("dis", "limit", "a"),
      step("c", "sort", "dis"),
    ];
    const w = run(steps, { a: 4, c: 0 });
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ stepId: "c", inputCounts: { parent: 4 } });
  });

  it("skips a root-level step of a NON-primary root (sourceRowCount is not its input)", () => {
    expect(run([step("z", "filter", undefined, "r2")], { z: 0 }, 9)).toEqual([]);
  });

  it("skips a step with no count entry and never warns from a missing parent entry", () => {
    const steps = [step("a", "filter", undefined, "r1"), step("b", "limit", "a")];
    expect(run(steps, { a: 5 })).toEqual([]);
  });

  it("does not warn when the input is itself empty", () => {
    const steps = [step("a", "filter", undefined, "r1"), step("b", "limit", "a")];
    expect(run(steps, { a: 0, b: 0 }, 0)).toEqual([]);
  });

  it.each([null, "garbage", 42, { secondaryInput: "x" }, { secondaryInput: { kind: "lane" } }])(
    "skips a malformed join config (%j) without throwing",
    (config) => {
      const steps = [
        step("a", "filter", undefined, "r1"),
        step("j", "join", "a", undefined, config),
      ];
      expect(() => run(steps, { a: 0, j: 0 }, 0)).not.toThrow();
      expect(run(steps, { a: 0, j: 0 }, 0)).toEqual([]);
    },
  );
});
