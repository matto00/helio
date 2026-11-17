import type { PipelineStep } from "../types/pipelineStep";
import type { Step } from "../types/step";
import {
  applyOp,
  deleteStep,
  isDraftClientId,
  liveTrunkIds,
  newClientId,
  replayOps,
  trunkAfterMove,
} from "./draftOps";
import { makeStep, OP_TYPES, pipelineStepToStep } from "./stepNarrowing";

function step(
  id: string,
  over: Partial<{ parentStepId: string | null; position: number; rootId: string | null }> = {},
): Step {
  return pipelineStepToStep({
    id,
    pipelineId: "p1",
    position: over.position ?? 0,
    createdAt: "",
    updatedAt: "",
    type: "limit",
    config: { count: 10 },
    enabled: true,
    parentStepId: over.parentStepId ?? null,
    rootId: over.rootId === undefined ? null : over.rootId,
  } as PipelineStep);
}

const LIMIT = { count: 5 };
const parentOf = (steps: Step[], id: string) => steps.find((s) => s.id === id)?.parentStepId;
const find = (steps: Step[], id: string) => steps.find((s) => s.id === id)!;
/** Every parent has at most one position-0 child: the invariant a partial reorder would break. */
const oneTrunkChildPerParent = (steps: Step[]) => {
  const seen = new Set<string>();
  for (const s of steps) {
    if (!s.parentStepId || (s.position ?? 0) !== 0) continue;
    if (seen.has(s.parentStepId)) return false;
    seen.add(s.parentStepId);
  }
  return true;
};

// a -> b -> c is root r1's trunk; t is a tail (position 1) of a.
const base = (): Step[] => [
  step("a", { rootId: "r1" }),
  step("t", { parentStepId: "a", position: 1 }),
  step("b", { parentStepId: "a" }),
  step("c", { parentStepId: "b" }),
];

describe("client ids", () => {
  it("are recognised, are not temp ids and stay within the draft-preview 64-character id cap", () => {
    const id = newClientId();
    expect(isDraftClientId(id)).toBe(true);
    expect(id.length).toBeLessThanOrEqual(64);
    expect(/^step-\d+$/.test(id)).toBe(false);
    expect(isDraftClientId("step-1")).toBe(false);
  });
});

// PipelineStepRepository.scala spliceInsertReportingInternal (line ~699): the new row is the anchor's child at position 0 and
// every existing child of the anchor (trunk continuation AND tails) is re-parented onto it, positions kept.
describe("insert after an anchor", () => {
  it("makes the new step the anchor's only child and moves the trunk continuation and the tails under it", () => {
    const next = applyOp(base(), {
      kind: "insert",
      clientId: "draft-n",
      type: "limit",
      config: LIMIT,
      anchor: { after: "a" },
    })!;
    expect(next.map((s) => s.id)).toEqual(["a", "draft-n", "t", "b", "c"]);
    expect(find(next, "draft-n")).toMatchObject({ parentStepId: "a", position: 0 });
    expect(parentOf(next, "b")).toBe("draft-n");
    expect(parentOf(next, "t")).toBe("draft-n");
    expect(find(next, "t").position).toBe(1);
    expect(next.filter((s) => s.parentStepId === "a").map((s) => s.id)).toEqual(["draft-n"]);
    expect(liveTrunkIds(next, "r1")).toEqual(["a", "draft-n", "b", "c"]);
  });

  it("does not re-parent a temp step the server has no row for", () => {
    const temp = makeStep(OP_TYPES[0], "a");
    const next = applyOp([...base(), temp], {
      kind: "insert",
      clientId: "draft-n",
      type: "limit",
      config: LIMIT,
      anchor: { after: "a" },
    })!;
    expect(parentOf(next, temp.id)).toBe("a");
  });

  it("is refused when the anchor is gone, when it is a temp step, or when the client id already exists", () => {
    const insert = (anchor: string, clientId = "draft-n") =>
      applyOp(base(), {
        kind: "insert",
        clientId,
        type: "limit",
        config: LIMIT,
        anchor: { after: anchor },
      });
    expect(insert("zzz")).toBeNull();
    expect(
      applyOp([...base(), makeStep(OP_TYPES[0])], {
        kind: "insert",
        clientId: "draft-n",
        type: "limit",
        config: LIMIT,
        anchor: { after: "step-1" },
      }),
    ).toBeNull();
    expect(insert("a", "b")).toBeNull();
  });
});

// resolveRootTrunkAnchor with position 0 (PipelineService.scala:414) -> spliceInsertReportingInternal with no anchor and an
// explicit root: the new step heads the root and the root's parentless steps move under it.
describe("insert at the head of a root", () => {
  it("heads the root and moves the old head under the new step", () => {
    const next = applyOp(base(), {
      kind: "insert",
      clientId: "draft-h",
      type: "limit",
      config: LIMIT,
      anchor: { head: "r1" },
    })!;
    expect(find(next, "draft-h")).toMatchObject({ rootId: "r1", position: 0 });
    expect(find(next, "draft-h").parentStepId).toBeUndefined();
    expect(parentOf(next, "a")).toBe("draft-h");
    expect(find(next, "a").rootId).toBeUndefined();
    expect(liveTrunkIds(next, "r1")).toEqual(["draft-h", "a", "b", "c"]);
  });

  it("only moves the named root's steps on a multi-root pipeline", () => {
    const two = [...base(), step("x", { rootId: "r2" })];
    const next = applyOp(two, {
      kind: "insert",
      clientId: "draft-h",
      type: "limit",
      config: LIMIT,
      anchor: { head: "r1" },
    })!;
    expect(find(next, "x").rootId).toBe("r2");
    expect(find(next, "x").parentStepId).toBeUndefined();
  });
});

// resolveRootTrunkAnchor with position None: the anchor is trunk.lastOption, so the splice also moves that step's tails.
describe("append", () => {
  it("goes after the last trunk step and takes over that step's tails", () => {
    const withTail = [...base(), step("t2", { parentStepId: "c", position: 1 })];
    const next = applyOp(withTail, {
      kind: "insert",
      clientId: "draft-p",
      type: "limit",
      config: LIMIT,
      anchor: { append: "r1" },
    })!;
    expect(parentOf(next, "draft-p")).toBe("c");
    expect(parentOf(next, "t2")).toBe("draft-p");
    expect(liveTrunkIds(next, "r1")).toEqual(["a", "b", "c", "draft-p"]);
  });

  it("heads an empty root", () => {
    const next = applyOp([], {
      kind: "insert",
      clientId: "draft-p",
      type: "limit",
      config: LIMIT,
      anchor: { append: "r1" },
    })!;
    expect(find(next, "draft-p")).toMatchObject({ rootId: "r1", position: 0 });
  });

  it("with two new steps already in the draft, an insert at the last gap is NOT an append", () => {
    const one = applyOp(base(), {
      kind: "insert",
      clientId: "draft-1",
      type: "limit",
      config: LIMIT,
      anchor: { append: "r1" },
    })!;
    const two = applyOp(one, {
      kind: "insert",
      clientId: "draft-2",
      type: "limit",
      config: LIMIT,
      anchor: { append: "r1" },
    })!;
    // The draft lane is a, b, c, draft-1, draft-2: the gap before the last card anchors on draft-1.
    const mid = applyOp(two, {
      kind: "insert",
      clientId: "draft-3",
      type: "limit",
      config: LIMIT,
      anchor: { after: "draft-1" },
    })!;
    expect(liveTrunkIds(mid, "r1")).toEqual(["a", "b", "c", "draft-1", "draft-3", "draft-2"]);
  });
});

// attachTailInternalAction (PipelineStepRepository.scala ~810): a new child at max sibling position + 1, at least 1, nothing moved.
describe("lane step", () => {
  it("lands at max sibling position + 1 and moves nothing", () => {
    const next = applyOp(base(), {
      kind: "lane",
      clientId: "draft-l",
      type: "limit",
      config: LIMIT,
      parent: "a",
    })!;
    expect(find(next, "draft-l")).toMatchObject({ parentStepId: "a", position: 2 });
    expect(parentOf(next, "b")).toBe("a");
    expect(parentOf(next, "t")).toBe("a");
  });

  it("is position 1 on a leaf, never 0 (0 would splice it into the trunk)", () => {
    const next = applyOp(base(), {
      kind: "lane",
      clientId: "draft-l",
      type: "limit",
      config: LIMIT,
      parent: "c",
    })!;
    expect(find(next, "draft-l").position).toBe(1);
    expect(liveTrunkIds(next, "r1")).toEqual(["a", "b", "c"]);
  });
});

// PipelineStepWrites.duplicateStep: spliceInsertAtInternal with the original as anchor, kind/config/enabled cloned.
describe("duplicate", () => {
  it("inserts a copy directly after the original with the captured config and enabled flag", () => {
    const next = applyOp(base(), {
      kind: "duplicate",
      clientId: "draft-d",
      of: "b",
      type: "limit",
      config: { count: 77 },
      enabled: false,
    })!;
    expect(liveTrunkIds(next, "r1")).toEqual(["a", "b", "draft-d", "c"]);
    expect(find(next, "draft-d")).toMatchObject({ config: { count: 77 }, enabled: false });
    expect(parentOf(next, "c")).toBe("draft-d");
  });

  it("is refused when the original is gone", () => {
    expect(
      applyOp(base(), {
        kind: "duplicate",
        clientId: "draft-d",
        of: "zzz",
        type: "limit",
        config: LIMIT,
        enabled: true,
      }),
    ).toBeNull();
  });
});

// reorderTrunkAction (PipelineStepRepository.scala ~906): the root's trunk is relinked, every trunk node at position 0; tails keep
// their parent id, so a tail follows its trunk step.
describe("reorder", () => {
  it("relinks the trunk in the new order, keeps tails on their step, and leaves one position-0 child per parent", () => {
    const next = applyOp(base(), { kind: "reorder", rootId: "r1", trunk: ["b", "a", "c"] })!;
    expect(liveTrunkIds(next, "r1")).toEqual(["b", "a", "c"]);
    expect(find(next, "b")).toMatchObject({ rootId: "r1", position: 0 });
    expect(find(next, "b").parentStepId).toBeUndefined();
    expect(find(next, "a").rootId).toBeUndefined();
    expect(parentOf(next, "t")).toBe("a");
    expect(oneTrunkChildPerParent(next)).toBe(true);
  });

  it("is dropped whole when the saved trunk gained a step after it was recorded", () => {
    const grown = [...base(), step("d", { parentStepId: "c" })];
    const { steps, keptOps, droppedOps } = replayOps(grown, [
      { kind: "reorder", rootId: "r1", trunk: ["b", "a", "c"] },
    ]);
    expect(keptOps).toEqual([]);
    expect(droppedOps).toHaveLength(1);
    expect(steps).toEqual(grown);
    expect(oneTrunkChildPerParent(steps)).toBe(true);
  });

  it("is dropped when the saved trunk lost a step", () => {
    const shrunk = base().filter((s) => s.id !== "c");
    expect(applyOp(shrunk, { kind: "reorder", rootId: "r1", trunk: ["b", "a", "c"] })).toBeNull();
  });
});

describe("a temp (step-N) step in the draft (D1a)", () => {
  const temp = (): Step => makeStep(OP_TYPES[0]);

  it("is never part of a root's live trunk, and a saved step moved across it is recorded without it and survives a replay over a base with no temp", () => {
    const withTemp = [...base(), temp()];
    const t = withTemp[withTemp.length - 1];
    expect(liveTrunkIds(withTemp, "r1")).toEqual(["a", "b", "c"]);
    // What reorderLane produces for "Move down on c's predecessor" with the swept temp at the end of the lane:
    // relinked chain a, c, b, temp (parent links only).
    const moved = withTemp.map((s) => {
      if (s.id === "a") return { ...s, parentStepId: undefined, rootId: "r1" };
      if (s.id === "c") return { ...s, parentStepId: "a", rootId: undefined };
      if (s.id === "b") return { ...s, parentStepId: "c", rootId: undefined };
      if (s.id === t.id) return { ...s, parentStepId: "b" };
      return s;
    });
    const recorded = trunkAfterMove(moved, "r1", liveTrunkIds(withTemp, "r1"));
    expect(recorded).toEqual(["a", "c", "b"]);
    expect(recorded).not.toContain(t.id);
    const replayed = applyOp(base(), { kind: "reorder", rootId: "r1", trunk: recorded })!;
    expect(liveTrunkIds(replayed, "r1")).toEqual(["a", "c", "b"]);
  });

  it("is hopped over when the move relinked it into the middle of the chain", () => {
    const t = temp();
    const moved = [
      { ...find(base(), "b"), parentStepId: undefined, rootId: "r1" },
      { ...find(base(), "a"), parentStepId: t.id, rootId: undefined },
      { ...t, parentStepId: "b" },
      { ...find(base(), "c"), parentStepId: "a" },
    ];
    expect(trunkAfterMove(moved, "r1", ["a", "b", "c"])).toEqual(["b", "a", "c"]);
  });

  it("refuses a lane or duplicate op anchored on it", () => {
    const t = temp();
    const steps = [...base(), t];
    expect(
      applyOp(steps, {
        kind: "lane",
        clientId: "draft-l",
        type: "limit",
        config: LIMIT,
        parent: t.id,
      }),
    ).toBeNull();
    expect(
      applyOp(steps, {
        kind: "duplicate",
        clientId: "draft-d",
        of: t.id,
        type: "limit",
        config: LIMIT,
        enabled: true,
      }),
    ).toBeNull();
  });
});

describe("delete of a new step (the server's delete semantics)", () => {
  it("promotes the first child and removes the other children with their subtrees, the tail the new step took over included", () => {
    const inserted = applyOp(base(), {
      kind: "insert",
      clientId: "draft-n",
      type: "limit",
      config: LIMIT,
      anchor: { after: "a" },
    })!;
    // draft-n now has children t (position 1) and b (position 0): b is promoted, t goes.
    const after = deleteStep(inserted, "draft-n");
    expect(after.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(parentOf(after, "b")).toBe("a");
  });

  it("restores the base exactly when the anchor had only its trunk continuation", () => {
    const noTail = base().filter((s) => s.id !== "t");
    const inserted = applyOp(noTail, {
      kind: "insert",
      clientId: "draft-n",
      type: "limit",
      config: LIMIT,
      anchor: { after: "a" },
    })!;
    const after = deleteStep(inserted, "draft-n");
    expect(after.map((s) => [s.id, s.parentStepId ?? null, s.position])).toEqual(
      noTail.map((s) => [s.id, s.parentStepId ?? null, s.position]),
    );
  });
});

describe("replayOps", () => {
  it("drops an op whose anchor is gone and every later op that names its client id", () => {
    const { keptOps, droppedOps } = replayOps(base(), [
      {
        kind: "insert",
        clientId: "draft-1",
        type: "limit",
        config: LIMIT,
        anchor: { after: "zzz" },
      },
      { kind: "lane", clientId: "draft-2", type: "limit", config: LIMIT, parent: "draft-1" },
      { kind: "delete", stepId: "c" },
    ]);
    expect(droppedOps.map((o) => o.kind)).toEqual(["insert", "lane"]);
    expect(keptOps.map((o) => o.kind)).toEqual(["delete"]);
  });
});
