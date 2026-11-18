import type { Output } from "../types/output";
import type { PipelineRoot, PipelineStep } from "../types/pipelineStep";
import type { Step } from "../types/step";
import type { DraftOp } from "./draftOps";
import { applyOp, replayOps } from "./draftOps";
import { opsTiedToDraftRoot, replayRoots, toDraftRoots } from "./draftRoots";
import {
  EMPTY_OVERLAY,
  rebaseOverlay,
  replayOverlay,
  toDraftOutputs,
  toDraftSteps,
  withOp,
  withRootAdd,
  withRootRemove,
} from "./pipelineDraft";
import { pipelineStepToStep } from "./stepNarrowing";

// HEL-1734 task 3.5: root add / remove in the draft op log (replay, cascade, prune, rebase, request mapping).

function step(
  id: string,
  over: { parentStepId?: string | null; rootId?: string | null } = {},
): Step {
  return pipelineStepToStep({
    id,
    pipelineId: "p1",
    position: 0,
    createdAt: "",
    updatedAt: "",
    type: "limit",
    config: { count: 10 },
    enabled: true,
    parentStepId: over.parentStepId ?? null,
    rootId: over.rootId ?? null,
  } as PipelineStep);
}

const root = (id: string, source = `ds-${id}`): PipelineRoot => ({
  id,
  dataSourceId: source,
  dataSourceName: source,
});
const SAVED_ROOTS = [root("r1"), root("r2")];
// r1: a -> b ; r2: c
const base = (): Step[] => [
  step("a", { rootId: "r1" }),
  step("b", { parentStepId: "a" }),
  step("c", { rootId: "r2" }),
];
const output = (id: string, over: Partial<Output>): Output =>
  ({ id, name: id, kind: "table", config: {}, schema: [], panelCount: 0, ...over }) as Output;

const add = (clientId: string, sourceId = "ds-new"): DraftOp => ({
  kind: "rootAdd",
  clientId,
  sourceId,
  dataSourceName: "New source",
});
const remove = (rootId: string): DraftOp => ({ kind: "rootRemove", rootId });

describe("replayRoots", () => {
  it("appends an added root last and removes a saved one, in the order the ops were made", () => {
    const { roots, droppedOps } = replayRoots(SAVED_ROOTS, [remove("r1"), add("draft-x")]);
    expect(roots.map((r) => r.id)).toEqual(["r2", "draft-x"]);
    expect(roots[1]).toEqual({
      id: "draft-x",
      dataSourceId: "ds-new",
      dataSourceName: "New source",
    });
    expect(droppedOps).toEqual([]);
  });

  it("drops a removal that would leave the pipeline with no root, and one naming a root that is not there", () => {
    const last = remove("r2");
    const ghost = remove("nope");
    const { roots, droppedOps } = replayRoots([root("r1")], [ghost, remove("r1")]);
    expect(roots.map((r) => r.id)).toEqual(["r1"]);
    expect(droppedOps).toHaveLength(2);
    expect(replayRoots(SAVED_ROOTS, [remove("r1"), last]).droppedOps).toEqual([last]);
  });

  it("drops an add whose client id is already a root, and an op naming a root removed earlier", () => {
    const insert: DraftOp = {
      kind: "insert",
      clientId: "draft-s",
      type: "limit",
      config: { count: 1 },
      anchor: { head: "r1" },
    };
    const again = add("draft-x");
    const { droppedOps } = replayRoots(SAVED_ROOTS, [add("draft-x"), again, remove("r1"), insert]);
    expect(droppedOps).toEqual([again, insert]);
  });
});

describe("a rootRemove over the steps and Outputs", () => {
  it("removes the root's steps and everything under them, as the server's cascade does, and nothing else", () => {
    const replayed = replayOps(base(), [remove("r1")]);
    expect(replayed.steps.map((s) => s.id)).toEqual(["c"]);
    expect(replayed.droppedOps).toEqual([]);
    expect(applyOp(base(), add("draft-x"))?.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("takes the root's Outputs with it (a step Output and a root-bound one), and keeps the other root's", () => {
    const outputs = [
      output("on-b", { nodeStepId: "b" }),
      output("on-r1", { rootId: "r1" }),
      output("on-c", { nodeStepId: "c" }),
      output("on-r2", { rootId: "r2" }),
    ];
    const replayed = replayOverlay(base(), { ...EMPTY_OVERLAY, ops: [remove("r1")] }, outputs);
    expect(replayed.outputs?.map((o) => o.id)).toEqual(["on-c", "on-r2"]);
    expect(replayed.dropped).toBe(0);
  });

  it("counts an op that names a removed root as dropped", () => {
    const insert: DraftOp = {
      kind: "insert",
      clientId: "draft-s",
      type: "limit",
      config: { count: 1 },
      anchor: { append: "r1" },
    };
    const replayed = replayOverlay(base(), { ...EMPTY_OVERLAY, ops: [remove("r1"), insert] });
    expect(replayed.droppedOps).toEqual([insert]);
  });
});

describe("withRootAdd / withRootRemove", () => {
  it("records a root add and a saved-root removal even though the steps equal the base (a root is not a step)", () => {
    const added = withRootAdd(base(), EMPTY_OVERLAY, add("draft-x") as never);
    expect(added.ops).toEqual([add("draft-x")]);
    const removedEmpty = withRootRemove([step("z", { rootId: "r9" })], EMPTY_OVERLAY, "r1");
    expect(removedEmpty.ops).toEqual([remove("r1")]);
  });

  it("leaves no trace of a root the draft added and then removed, with every step and Output made on it", () => {
    let o = withRootAdd(base(), EMPTY_OVERLAY, add("draft-x") as never);
    o = withOp(base(), o, {
      kind: "insert",
      clientId: "draft-s",
      type: "limit",
      config: { count: 1 },
      anchor: { head: "draft-x" },
    });
    o = withOp(base(), o, {
      kind: "lane",
      clientId: "draft-lane",
      type: "limit",
      config: { count: 2 },
      parent: "draft-s",
    });
    o = withOp(base(), o, {
      kind: "outputCreate",
      clientId: "draft-o",
      node: { step: "draft-lane" },
      outputKind: "table",
      name: "n",
      config: {},
    });
    expect(o.ops).toHaveLength(4);
    expect(withRootRemove(base(), o, "draft-x")).toBe(EMPTY_OVERLAY);
  });

  it("keeps an unrelated op when a draft root is removed", () => {
    const unrelated: DraftOp = { kind: "delete", stepId: "c" };
    let o = withOp(base(), EMPTY_OVERLAY, unrelated);
    o = withRootAdd(base(), o, add("draft-x") as never);
    expect(withRootRemove(base(), o, "draft-x").ops).toEqual([unrelated]);
  });

  it("lists the tied ops of a draft root transitively", () => {
    const insert: DraftOp = {
      kind: "insert",
      clientId: "draft-s",
      type: "limit",
      config: { count: 1 },
      anchor: { head: "draft-x" },
    };
    const dup: DraftOp = {
      kind: "duplicate",
      clientId: "draft-d",
      of: "draft-s",
      type: "limit",
      config: { count: 1 },
      enabled: true,
    };
    const other: DraftOp = { kind: "delete", stepId: "c" };
    const tied = opsTiedToDraftRoot([add("draft-x"), insert, dup, other], "draft-x");
    expect([...tied]).toEqual([add("draft-x"), insert, dup].map((x) => expect.objectContaining(x)));
  });
});

describe("rebaseOverlay with roots", () => {
  it("keeps a root op the new saved roots can take and counts one they cannot", () => {
    const ops = [add("draft-x"), remove("r2")];
    const overlay = { ...EMPTY_OVERLAY, ops };
    const kept = rebaseOverlay(base(), overlay, null, SAVED_ROOTS);
    expect(kept.dropped).toBe(0);
    expect(kept.overlay.ops).toEqual(ops);
    // r2 was removed by someone else: the draft's own removal of it no longer applies.
    const gone = rebaseOverlay(
      [step("a", { rootId: "r1" }), step("b", { parentStepId: "a" })],
      overlay,
      null,
      [root("r1")],
    );
    expect(gone.dropped).toBe(1);
    expect(gone.overlay.ops).toEqual([add("draft-x")]);
  });
});

describe("the save request's roots", () => {
  it("is absent when the draft changes no root, and lists the final roots (saved by id, new by clientId and source) otherwise", () => {
    expect(toDraftRoots([], SAVED_ROOTS)).toBeUndefined();
    const { roots } = replayRoots(SAVED_ROOTS, [remove("r1"), add("draft-x", "ds-new")]);
    expect(toDraftRoots([remove("r1"), add("draft-x", "ds-new")], roots)).toEqual([
      { id: "r2" },
      { clientId: "draft-x", sourceId: "ds-new" },
    ]);
  });

  it("names a draft root by rootClientId on a step and on a root-bound Output", () => {
    const steps = [step("draft-s", { rootId: "draft-x" }), step("a", { rootId: "r1" })];
    const mapped = toDraftSteps(steps);
    expect(mapped[0]).toMatchObject({ clientId: "draft-s", rootClientId: "draft-x" });
    expect(mapped[0].rootId).toBeUndefined();
    expect(mapped[1]).toMatchObject({ id: "a", rootId: "r1" });
    const outs = toDraftOutputs([output("draft-o", { rootId: "draft-x" })], steps, "r1");
    expect(outs[0]).toMatchObject({ clientId: "draft-o", rootClientId: "draft-x" });
    expect(outs[0].rootId).toBeUndefined();
  });
});
