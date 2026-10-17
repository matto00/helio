// HEL-1581 — the walk's own behaviour: schema, incremental recompute and the HEL-970 rejoin.

import {
  evaluatePipeline,
  frameSchema,
  type RootFrame,
  type StepDefinition,
} from "./evaluatePipeline";
import { decodeRows, readCorpusFile } from "./testing/corpus";
import type { Frame } from "./value";

interface WalkVector {
  name: string;
  rootFrames: Array<{ rootId: string; rows: unknown[] }>;
  steps: StepDefinition[];
}

const { vectors } = readCorpusFile<{ vectors: WalkVector[] }>("pipelines.json");
const rootsOf = (v: WalkVector): RootFrame[] =>
  v.rootFrames.map((r) => ({ rootId: r.rootId, rows: decodeRows(r.rows) as Frame }));

describe("frameSchema (Decision 5: the ordered column-name union, first seen wins)", () => {
  it("is empty for an empty frame", () => {
    expect(frameSchema([])).toEqual([]);
  });

  it("unions rows with differing key sets in row order, then key order", () => {
    expect(frameSchema([{ b: 1, a: 2 }, { c: 3 }, { a: 4, d: 5, b: 6 }])).toEqual([
      "b",
      "a",
      "c",
      "d",
    ]);
  });

  it("follows a select that reorders columns", () => {
    const walk = evaluatePipeline(
      [
        {
          id: "s",
          kind: "select",
          parentStepId: null,
          rootId: "r",
          position: 0,
          enabled: true,
          config: { fields: ["b", "a"] },
        },
      ],
      [{ rootId: "r", rows: [{ a: 1, b: 2, c: 3 }] }],
    );
    // select keeps the row's own key order (the Scala Map has none), so the schema is the row's order restricted to the fields
    expect(walk.nodes.get("s")).toMatchObject({ status: "ok", count: 1, schema: ["a", "b"] });
  });
});

describe("incremental recompute (Decision 5)", () => {
  const dependentsOf = (steps: readonly StepDefinition[], id: string): Set<string> => {
    const out = new Set<string>([id]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const s of steps) {
        const lane = (s.config as { secondaryInput?: { kind?: string; stepId?: string } } | null)
          ?.secondaryInput;
        const dependsOn =
          (s.parentStepId !== null && out.has(s.parentStepId)) ||
          (lane?.kind === "lane" && out.has(lane.stepId ?? ""));
        if (dependsOn && !out.has(s.id)) {
          out.add(s.id);
          grew = true;
        }
      }
    }
    return out;
  };

  describe.each(vectors.map((v) => [v.name, v] as const))("%s", (_name, vector) => {
    it("equals a full recompute for every step as the edited step, reusing unaffected frames by reference", () => {
      const roots = rootsOf(vector);
      const full = evaluatePipeline(vector.steps, roots);
      for (const step of vector.steps) {
        const incremental = evaluatePipeline(vector.steps, roots, {
          previous: full,
          editedStepId: step.id,
        });
        expect([...incremental.nodes.entries()]).toEqual([...full.nodes.entries()]);
        const affected = dependentsOf(vector.steps, step.id);
        for (const other of vector.steps) {
          const before = full.nodes.get(other.id)!;
          const after = incremental.nodes.get(other.id)!;
          // A lane violation does not wait for the step it names, so editing that step does not touch it.
          const violation =
            before.status === "error" && before.message.startsWith("lane reference");
          if (affected.has(other.id) && !violation) expect(after).not.toBe(before);
          if (!affected.has(other.id)) expect(after).toBe(before);
        }
      }
    });
  });

  const edits: Record<string, (s: StepDefinition) => StepDefinition> = {
    limit: (s) => ({ ...s, config: { count: 1 } }),
    filter: (s) => ({
      ...s,
      config: { combinator: "AND", conditions: [{ field: "age", operator: ">", value: "35" }] },
    }),
    sort: (s) => ({ ...s, config: { sortBy: [{ field: "id", direction: "desc" }] } }),
  };

  it("a real edit recomputes to the same result as a full run, including through a lane edge (the HEL-970 rejoin)", () => {
    const vector = vectors.find((v) => v.name.startsWith("HEL-970 rejoin"))!;
    const roots = rootsOf(vector);
    const before = evaluatePipeline(vector.steps, roots);
    const edited = vector.steps.map((s) => (s.id === "t1" ? edits.filter(s) : s));
    const full = evaluatePipeline(edited, roots);
    const incremental = evaluatePipeline(edited, roots, { previous: before, editedStepId: "t1" });
    expect([...incremental.nodes.entries()]).toEqual([...full.nodes.entries()]);
    // t1 is a sibling branch of j, not its ancestor: only the lane edge carries the edit to j
    const rowsOf = (w: typeof full, id: string): Frame => (w.nodes.get(id) as { rows: Frame }).rows;
    expect(rowsOf(incremental, "j")).not.toEqual(rowsOf(before, "j"));
    expect(incremental.nodes.get("j")).not.toBe(before.nodes.get("j"));
    expect(incremental.nodes.get("s1")).toBe(before.nodes.get("s1"));
  });

  it.each(["HEL-970 rejoin", "linear", "a tail branch"])(
    "a real edit equals a full recompute: %s",
    (prefix) => {
      const vector = vectors.find((v) => v.name.startsWith(prefix))!;
      const roots = rootsOf(vector);
      const before = evaluatePipeline(vector.steps, roots);
      for (const target of vector.steps.filter((s) => edits[s.kind])) {
        const edited = vector.steps.map((s) => (s.id === target.id ? edits[s.kind](s) : s));
        const full = evaluatePipeline(edited, roots);
        const incremental = evaluatePipeline(edited, roots, {
          previous: before,
          editedStepId: target.id,
        });
        expect([...incremental.nodes.entries()]).toEqual([...full.nodes.entries()]);
      }
    },
  );

  it("a step with no previous entry is computed", () => {
    const vector = vectors.find((v) => v.name.startsWith("linear"))!;
    const roots = rootsOf(vector);
    const before = evaluatePipeline(vector.steps.slice(0, 2), roots);
    const added = evaluatePipeline(vector.steps, roots, { previous: before, editedStepId: "s2" });
    expect(added.nodes.get("s3")!.status).toBe("ok");
  });
});

describe("the walk's order and statuses", () => {
  it("visits children in descending position, depth first (executeTree's structural rank)", () => {
    const vector = vectors.find((v) => v.name.startsWith("a tail position ordering"))!;
    const walk = evaluatePipeline(vector.steps, rootsOf(vector));
    expect(walk.order).toEqual(["s1", "a", "d", "b", "c"]);
  });

  it("an upsertsource step is flagged writesOnSave and passes its rows through", () => {
    const walk = evaluatePipeline(
      [
        {
          id: "u",
          kind: "upsertsource",
          parentStepId: null,
          rootId: "r",
          position: 0,
          enabled: true,
          config: { target: { kind: "newSource", name: "S" } },
        },
      ],
      [{ rootId: "r", rows: [{ a: 1 }] }],
    );
    expect(walk.nodes.get("u")).toMatchObject({ status: "ok", writesOnSave: true, count: 1 });
  });
});
