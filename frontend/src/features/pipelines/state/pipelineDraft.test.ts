import type { Output } from "../types/output";
import type { DraftStep } from "../types/draftSave";
import type { PipelineStep, PipelineStepConfig } from "../types/pipelineStep";
import type { Step } from "../types/step";
import {
  EMPTY_OVERLAY,
  applyOverlay,
  definitionMatchesBase,
  deleteStep,
  hasDraft,
  outputsOnRemovedSteps,
  pruneOverlay,
  rebaseOverlay,
  replayOverlay,
  withOp,
  removedStepIds,
  toDraftOutputs,
  toDraftSteps,
  withConfig,
  withDeleted,
  withEnabled,
} from "./pipelineDraft";
import { pipelineStepToStep } from "./stepNarrowing";

function step(
  id: string,
  over: Partial<{
    type: PipelineStep["type"];
    config: unknown;
    enabled: boolean;
    parentStepId: string | null;
    rootId: string | null;
    position: number;
  }> = {},
): Step {
  return pipelineStepToStep({
    id,
    pipelineId: "p1",
    position: over.position ?? 0,
    createdAt: "",
    updatedAt: "",
    type: over.type ?? "limit",
    config: over.config ?? { count: 10 },
    enabled: over.enabled ?? true,
    parentStepId: over.parentStepId ?? null,
    rootId: over.rootId === undefined ? "r1" : over.rootId,
  } as PipelineStep);
}

const limit = (count: number): PipelineStepConfig => ({ count });

function output(id: string, over: Partial<Output> = {}): Output {
  return {
    id,
    pipelineId: "p1",
    ownerId: "u1",
    name: id,
    kind: "table",
    config: {},
    schema: [],
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

describe("overlay", () => {
  const base = [
    step("a", { parentStepId: null }),
    step("b", { parentStepId: "a" }),
    step("c", { parentStepId: "b" }),
  ];

  it("has no draft until something differs from the base", () => {
    expect(hasDraft(EMPTY_OVERLAY)).toBe(false);
    expect(applyOverlay(base, EMPTY_OVERLAY)).toBe(base);
  });

  it("applies a config edit and drops it when edited back to the saved value", () => {
    const edited = withConfig(base, EMPTY_OVERLAY, "b", limit(3));
    expect(hasDraft(edited)).toBe(true);
    expect(applyOverlay(base, edited).find((s) => s.id === "b")?.config).toEqual({ count: 3 });
    expect(base.find((s) => s.id === "b")?.config).toEqual({ count: 10 });
    const back = withConfig(base, edited, "b", limit(10));
    expect(hasDraft(back)).toBe(false);
    expect(back).toBe(EMPTY_OVERLAY);
  });

  it("treats a config with the same content in a different key order as unchanged", () => {
    const filterBase = [
      step("f", { type: "filter", config: { combinator: "and", conditions: [] } }),
    ];
    const next = withConfig(filterBase, EMPTY_OVERLAY, "f", {
      conditions: [],
      combinator: "and",
    } as PipelineStepConfig);
    expect(hasDraft(next)).toBe(false);
  });

  it("toggles enabled and prunes a toggle back to the saved flag", () => {
    const off = withEnabled(base, EMPTY_OVERLAY, "b", false);
    expect(applyOverlay(base, off).find((s) => s.id === "b")?.enabled).toBe(false);
    expect(hasDraft(withEnabled(base, off, "b", true))).toBe(false);
  });

  it("leaves the base steps untouched", () => {
    const snapshot = JSON.stringify(base);
    applyOverlay(base, withDeleted(base, withConfig(base, EMPTY_OVERLAY, "a", limit(1)), "c"));
    expect(JSON.stringify(base)).toBe(snapshot);
  });
});

describe("delete emulation (server splice semantics)", () => {
  it("deleting a trunk step promotes its only child onto its slot", () => {
    const steps = [
      step("a", { parentStepId: null, position: 0 }),
      step("b", { parentStepId: "a", position: 0 }),
      step("c", { parentStepId: "b", position: 0 }),
    ];
    const after = deleteStep(steps, "b");
    expect(after.map((s) => s.id)).toEqual(["a", "c"]);
    expect(after.find((s) => s.id === "c")?.parentStepId).toBe("a");
    expect(after.find((s) => s.id === "c")?.position).toBe(0);
  });

  it("deleting a root-level step hands its root and null parent to the promoted child", () => {
    const steps = [
      step("a", { parentStepId: null, position: 0, rootId: "r1" }),
      step("b", { parentStepId: "a", position: 0, rootId: "r1" }),
    ];
    const after = deleteStep(steps, "a");
    expect(after).toHaveLength(1);
    expect(after[0].parentStepId).toBeUndefined();
    expect(after[0].rootId).toBe("r1");
  });

  it("deleting a childless tail leaf removes only that step", () => {
    const steps = [
      step("a", { parentStepId: null }),
      step("b", { parentStepId: "a", position: 0 }),
      step("t", { parentStepId: "a", position: 1 }),
    ];
    expect(deleteStep(steps, "t").map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("deleting a branch point promotes the first child and removes the other child and its subtree", () => {
    const steps = [
      step("a", { parentStepId: null }),
      step("b", { parentStepId: "a", position: 0 }),
      step("t", { parentStepId: "a", position: 1 }),
      step("t2", { parentStepId: "t", position: 0 }),
    ];
    const after = deleteStep(steps, "a");
    expect(after.map((s) => s.id)).toEqual(["b"]);
    expect(after[0].parentStepId).toBeUndefined();
    expect(removedStepIds(steps, after).sort()).toEqual(["a", "t", "t2"]);
  });

  it("breaks a position tie by id like the server", () => {
    const steps = [
      step("a", { parentStepId: null }),
      step("z", { parentStepId: "a", position: 0 }),
      step("m", { parentStepId: "a", position: 0 }),
    ];
    expect(deleteStep(steps, "a").map((s) => s.id)).toEqual(["m"]);
  });

  it("drops overlay edits for steps a delete removed", () => {
    const steps = [
      step("a", { parentStepId: null }),
      step("b", { parentStepId: "a", position: 0 }),
      step("t", { parentStepId: "a", position: 1 }),
    ];
    const edited = withConfig(steps, EMPTY_OVERLAY, "t", limit(1));
    const deleted = withDeleted(steps, edited, "a");
    expect(Object.keys(deleted.configs)).toEqual([]);
  });

  it("finds the Outputs on removed steps", () => {
    const outputs = [output("o1", { nodeStepId: "t" }), output("o2", { nodeStepId: "b" })];
    expect(outputsOnRemovedSteps(outputs, ["t", "a"]).map((o) => o.id)).toEqual(["o1"]);
  });
});

describe("rebaseOverlay", () => {
  it("keeps edits whose step still exists and counts the ones that no longer apply", () => {
    const oldBase = [step("a"), step("b", { parentStepId: "a" })];
    const overlay = withConfig(
      oldBase,
      withConfig(oldBase, EMPTY_OVERLAY, "a", limit(1)),
      "b",
      limit(2),
    );
    const newBase = [step("a")];
    const { overlay: next, dropped } = rebaseOverlay(newBase, overlay);
    expect(dropped).toBe(1);
    expect(next.configs).toEqual({ a: { count: 1 } });
  });
});

describe("save request", () => {
  it("always sends an explicit enabled boolean, so a disabled step stays disabled", () => {
    const steps = [step("a", { enabled: false }), step("b", { parentStepId: "a" })];
    const body = toDraftSteps(steps);
    expect(body[0].enabled).toBe(false);
    expect(body[1].enabled).toBe(true);
  });

  it("names the parent step when there is one and the root otherwise", () => {
    const body: DraftStep[] = toDraftSteps([
      step("a", { position: 0 }),
      step("b", { parentStepId: "a", position: 2 }),
    ]);
    expect(body[0]).toMatchObject({ id: "a", type: "limit", rootId: "r1", position: 0 });
    expect(body[0].parentStepId).toBeUndefined();
    expect(body[1]).toMatchObject({ id: "b", parentStepId: "a", position: 2 });
    expect(body[1].rootId).toBeUndefined();
  });

  it("leaves out Outputs on removed steps and keeps a root Output bound to its root", () => {
    const steps = [step("a")];
    const outputs = [
      output("o1", { nodeStepId: "a" }),
      output("o2", { nodeStepId: "gone" }),
      output("o3", { rootId: "r1" }),
      output("o4"),
    ];
    const body = toDraftOutputs(outputs, steps, "r9");
    expect(body.map((o) => o.id)).toEqual(["o1", "o3", "o4"]);
    expect(body[0].nodeStepId).toBe("a");
    expect(body[1]).toMatchObject({ rootId: "r1" });
    expect(body[2]).toMatchObject({ rootId: "r9" });
  });
});

describe("definitionMatchesBase", () => {
  const steps = [step("a"), step("b", { parentStepId: "a", config: { count: 4 } })];
  const outputs = [output("o1", { nodeStepId: "b", config: { x: 1, y: 2 } })];

  it("matches a definition that equals the base regardless of order and key order", () => {
    const def = {
      steps: [steps[1], steps[0]],
      outputs: [output("o1", { nodeStepId: "b", config: { y: 2, x: 1 } })],
    };
    expect(definitionMatchesBase(def, steps, outputs)).toBe(true);
  });

  it("rejects a changed step config, a missing step and a changed Output", () => {
    expect(
      definitionMatchesBase(
        { steps: [steps[0], step("b", { parentStepId: "a", config: { count: 5 } })], outputs },
        steps,
        outputs,
      ),
    ).toBe(false);
    expect(definitionMatchesBase({ steps: [steps[0]], outputs }, steps, outputs)).toBe(false);
    expect(
      definitionMatchesBase(
        { steps, outputs: [output("o1", { nodeStepId: "a" })] },
        steps,
        outputs,
      ),
    ).toBe(false);
  });

  it("does not compare Outputs while the page has not loaded them", () => {
    expect(definitionMatchesBase({ steps, outputs: [] }, steps, null)).toBe(true);
  });
});

describe("structure ops in the overlay (HEL-1684)", () => {
  const base = [
    step("a", { parentStepId: null }),
    step("b", { parentStepId: "a", rootId: null }),
    step("c", { parentStepId: "b", rootId: null }),
  ];
  const insertAfterA = {
    kind: "insert",
    clientId: "draft-1",
    type: "limit",
    config: { count: 3 },
    anchor: { after: "a" },
  } as const;

  it("a step added after a leaf and then deleted leaves no draft at all", () => {
    const added = withOp(base, EMPTY_OVERLAY, {
      ...insertAfterA,
      anchor: { after: "c" },
    });
    expect(hasDraft(added)).toBe(true);
    expect(hasDraft(withDeleted(base, added, "draft-1"))).toBe(false);
    expect(withDeleted(base, added, "draft-1")).toBe(EMPTY_OVERLAY);
  });

  it("Move down followed by Move up is no draft", () => {
    const down = withOp(base, EMPTY_OVERLAY, {
      kind: "reorder",
      rootId: "r1",
      trunk: ["b", "a", "c"],
    });
    expect(hasDraft(down)).toBe(true);
    const back = withOp(base, down, { kind: "reorder", rootId: "r1", trunk: ["a", "b", "c"] });
    expect(back).toBe(EMPTY_OVERLAY);
  });

  it("an edit to a new step lives under its client id and is pruned when set back to the op's own config", () => {
    const added = withOp(base, EMPTY_OVERLAY, insertAfterA);
    const edited = withConfig(base, added, "draft-1", limit(9));
    expect(applyOverlay(base, edited).find((s) => s.id === "draft-1")?.config).toEqual({
      count: 9,
    });
    expect(withConfig(base, edited, "draft-1", limit(3)).configs).toEqual({});
  });

  it("deleting the new step drops its config entry and restores the base when nothing else changed", () => {
    const edited = withConfig(base, withOp(base, EMPTY_OVERLAY, insertAfterA), "draft-1", limit(9));
    expect(withDeleted(base, edited, "draft-1")).toBe(EMPTY_OVERLAY);
  });

  it("a duplicate keeps the config captured when it was recorded, whatever the original is later edited to", () => {
    const dup = withOp(base, EMPTY_OVERLAY, {
      kind: "duplicate",
      clientId: "draft-d",
      of: "b",
      type: "limit",
      config: limit(10),
      enabled: true,
    });
    const edited = withConfig(base, dup, "b", limit(99));
    const steps = applyOverlay(base, edited);
    expect(steps.find((s) => s.id === "draft-d")?.config).toEqual(limit(10));
    expect(steps.find((s) => s.id === "b")?.config).toEqual(limit(99));
  });

  it("replay reports an op whose steps are gone from the base and the entries that go with it", () => {
    const added = withConfig(base, withOp(base, EMPTY_OVERLAY, insertAfterA), "draft-1", limit(9));
    const shrunk = base.filter((s) => s.id !== "a");
    const replayed = replayOverlay(shrunk, added);
    expect(replayed.droppedOps).toHaveLength(1);
    expect(replayed.droppedEntries).toBe(1);
    expect(replayed.dropped).toBe(2);
    expect(pruneOverlay(shrunk, added)).toBe(EMPTY_OVERLAY);
  });

  it("rebase keeps every op whose steps still exist, drops a dependent op with its parent, and counts them", () => {
    const first = withOp(base, EMPTY_OVERLAY, insertAfterA);
    const both = withOp(base, first, {
      kind: "lane",
      clientId: "draft-2",
      type: "limit",
      config: limit(1),
      parent: "draft-1",
    });
    const kept = withDeleted(base, both, "c");
    const newBase = base.filter((s) => s.id !== "a");
    const { overlay, dropped } = rebaseOverlay(newBase, kept);
    expect(dropped).toBe(2);
    expect(overlay.ops.map((o) => o.kind)).toEqual(["delete"]);
  });

  it("toDraftSteps sends a new step by clientId, and a step under it by parentClientId", () => {
    const added = withOp(base, EMPTY_OVERLAY, insertAfterA);
    const body = toDraftSteps(applyOverlay(base, added));
    const fresh = body.find((s) => s.clientId === "draft-1")!;
    expect(fresh.id).toBeUndefined();
    expect(fresh.parentStepId).toBe("a");
    const moved = body.find((s) => s.id === "b")!;
    expect(moved.parentClientId).toBe("draft-1");
    expect(moved.parentStepId).toBeUndefined();
  });
});
