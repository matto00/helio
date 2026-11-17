import type { Output } from "../types/output";
import type { PipelineStep } from "../types/pipelineStep";
import type { Step } from "../types/step";
import type { DraftOp } from "./draftOps";
import { draftMerge } from "./draftOutputs";
import {
  EMPTY_OVERLAY,
  hasDraft,
  pruneOverlay,
  rebaseOverlay,
  replayOverlay,
  toDraftOutputs,
  withConfig,
  withDeleted,
  withOp,
  withOutputEdit,
  type DraftOverlay,
} from "./pipelineDraft";
import { pipelineStepToStep } from "./stepNarrowing";
import parity from "./__fixtures__/nodeCapabilitiesParity.json";

function step(id: string, parent: string | null = null, position = 0): Step {
  return pipelineStepToStep({
    id,
    pipelineId: "p1",
    position,
    createdAt: "",
    updatedAt: "",
    type: "limit",
    config: { count: 10 },
    enabled: true,
    parentStepId: parent,
    rootId: parent === null ? "r1" : null,
  } as PipelineStep);
}

function output(id: string, nodeStepId: string | undefined, name = id): Output {
  return {
    id,
    pipelineId: "p1",
    ownerId: "u1",
    name,
    kind: "table",
    config: {},
    schema: [],
    createdAt: "",
    updatedAt: "",
    ...(nodeStepId !== undefined ? { nodeStepId } : { rootId: "r1" }),
  };
}

const base = [step("a"), step("b", "a")];
const outputs = [output("o1", "b"), output("o2", "a")];
const create = (clientId: string, node: string, name = "new"): DraftOp => ({
  kind: "outputCreate",
  clientId,
  node: { step: node },
  outputKind: "table",
  name,
  config: {},
});
const overlayOf = (over: Partial<DraftOverlay>): DraftOverlay => ({ ...EMPTY_OVERLAY, ...over });

describe("interleaved replay of Output ops (HEL-1733 D1)", () => {
  it("applies an outputCreate and an outputDelete, and shows the created Output with its client id", () => {
    const r = replayOverlay(
      base,
      overlayOf({ ops: [create("draft-1", "a", "  "), { kind: "outputDelete", outputId: "o1" }] }),
      outputs,
    );
    expect(r.outputs?.map((o) => o.id)).toEqual(["o2", "draft-1"]);
    expect(r.outputs?.[1]).toMatchObject({
      name: "Untitled output",
      nodeStepId: "a",
      panelCount: 0,
    });
    expect(r.dropped).toBe(0);
  });

  it("counts an outputCreate whose saved node vanished (a rebase) and Save sends nothing", () => {
    const r = replayOverlay(base, overlayOf({ ops: [create("draft-1", "gone")] }), outputs);
    expect(r.dropped).toBe(1);
    expect(r.outputs?.map((o) => o.id)).toEqual(["o1", "o2"]);
  });

  it("removes an Output created on a step a LATER delete removes, without counting it", () => {
    const grown = [...base, step("c", "b")];
    const r = replayOverlay(
      grown,
      overlayOf({
        ops: [
          {
            kind: "insert",
            clientId: "draft-s",
            type: "limit",
            config: { count: 1 },
            anchor: { after: "c" },
          },
          create("draft-o", "draft-s"),
          { kind: "delete", stepId: "draft-s" },
        ],
      }),
      outputs,
    );
    expect(r.outputs?.map((o) => o.id)).toEqual(["o1", "o2"]);
    expect(r.dropped).toBe(0);
  });

  it("cascades a saved Output when its step is deleted, and an outputDelete after that is a counted-free no-op", () => {
    const r = replayOverlay(
      base,
      overlayOf({
        ops: [
          { kind: "delete", stepId: "b" },
          { kind: "outputDelete", outputId: "o1" },
        ],
      }),
      outputs,
    );
    expect(r.outputs?.map((o) => o.id)).toEqual(["o2"]);
    expect(r.dropped).toBe(0);
  });

  it("counts an outputDelete of an Output that is simply not there", () => {
    const r = replayOverlay(
      base,
      overlayOf({ ops: [{ kind: "outputDelete", outputId: "zz" }] }),
      outputs,
    );
    expect(r.dropped).toBe(1);
  });

  it("carries Output ops through untouched, uncounted, while the base Outputs are not loaded", () => {
    const ops = [create("draft-1", "gone"), { kind: "outputDelete", outputId: "zz" } as DraftOp];
    const r = replayOverlay(
      base,
      overlayOf({ ops, outputEdits: { zz: { name: "x", config: {} } } }),
      null,
    );
    expect(r.dropped).toBe(0);
    expect(r.outputs).toBeNull();
    const pruned = pruneOverlay(base, overlayOf({ ops }), false, null);
    expect(pruned.ops).toHaveLength(2);
  });

  it("applies an Output edit, and counts an edit entry for an Output a rebase lost", () => {
    const r = replayOverlay(
      base,
      overlayOf({
        outputEdits: {
          o1: { name: "renamed", config: { a: 1 } },
          ghost: { name: "g", config: {} },
        },
      }),
      outputs,
    );
    expect(r.outputs?.find((o) => o.id === "o1")).toMatchObject({
      name: "renamed",
      config: { a: 1 },
    });
    expect(r.dropped).toBe(1);
  });
});

describe("canonical no-draft with Outputs (HEL-1733 D2)", () => {
  it("keeps an outputCreate when a step config edit sits beside it (the structure reset drops step ops only)", () => {
    let o = withOp(base, EMPTY_OVERLAY, create("draft-1", "a"), false, outputs);
    o = withConfig(base, o, "a", { count: 99 }, false, outputs);
    expect(o.ops).toHaveLength(1);
    expect(hasDraft(o)).toBe(true);
  });

  it("an edit set back to the saved name and config leaves no draft", () => {
    let o = withOutputEdit(base, EMPTY_OVERLAY, "o1", { name: "x", config: {} }, false, outputs);
    expect(hasDraft(o)).toBe(true);
    o = withOutputEdit(base, o, "o1", { name: "o1", config: {} }, false, outputs);
    expect(o).toBe(EMPTY_OVERLAY);
  });

  it("create then delete of the same Output leaves nothing, with its edit entry", () => {
    let o = withOp(base, EMPTY_OVERLAY, create("draft-1", "a"), false, outputs);
    o = withOutputEdit(base, o, "draft-1", { name: "x", config: { k: 1 } }, false, outputs);
    expect(o.outputEdits).toHaveProperty("draft-1");
    o = withOp(base, o, { kind: "outputDelete", outputId: "draft-1" }, false, outputs);
    expect(o).toBe(EMPTY_OVERLAY);
  });

  it("edit then delete of a saved Output leaves only the delete (dropped 0)", () => {
    let o = withOutputEdit(base, EMPTY_OVERLAY, "o1", { name: "x", config: {} }, false, outputs);
    o = withOp(base, o, { kind: "outputDelete", outputId: "o1" }, false, outputs);
    expect(o.outputEdits).toEqual({});
    expect(o.ops).toEqual([{ kind: "outputDelete", outputId: "o1" }]);
    expect(replayOverlay(base, o, outputs).dropped).toBe(0);
  });

  it("an edit of a created Output equal to its create is dropped and the op kept", () => {
    let o = withOp(base, EMPTY_OVERLAY, create("draft-1", "a", "new"), false, outputs);
    o = withOutputEdit(base, o, "draft-1", { name: "new", config: {} }, false, outputs);
    expect(o.outputEdits).toEqual({});
    expect(o.ops).toHaveLength(1);
  });

  it("an Output the step cascade removed is forgotten with its edit", () => {
    let o = withOp(base, EMPTY_OVERLAY, create("draft-1", "b"), false, outputs);
    o = withOutputEdit(base, o, "draft-1", { name: "x", config: {} }, false, outputs);
    o = withDeleted(base, o, "b", false, outputs);
    expect(o.ops).toEqual([{ kind: "delete", stepId: "b" }]);
    expect(o.outputEdits).toEqual({});
  });

  it("a stale-restored draft (keepOps) keeps every Output op so Reload can count them", () => {
    const ops = [{ kind: "outputDelete", outputId: "zz" } as DraftOp];
    expect(pruneOverlay(base, overlayOf({ ops }), true, outputs).ops).toHaveLength(1);
    const { dropped } = rebaseOverlay(base, overlayOf({ ops }), outputs);
    expect(dropped).toBe(1);
  });
});

describe("the save body for draft Outputs (HEL-1733 D9)", () => {
  it("names a created Output by clientId and a draft-new node by nodeStepClientId; a saved root Output keeps its root", () => {
    const r = replayOverlay(
      base,
      overlayOf({
        ops: [
          {
            kind: "insert",
            clientId: "draft-s",
            type: "limit",
            config: { count: 1 },
            anchor: { after: "b" },
          },
          create("draft-o", "draft-s", "N"),
          create("draft-p", "a", "P"),
        ],
      }),
      [...outputs, output("o3", undefined)],
    );
    expect(toDraftOutputs(r.outputs ?? [], r.steps, "r1")).toEqual([
      { id: "o1", name: "o1", kind: "table", config: {}, nodeStepId: "b" },
      { id: "o2", name: "o2", kind: "table", config: {}, nodeStepId: "a" },
      { id: "o3", name: "o3", kind: "table", config: {}, rootId: "r1" },
      { clientId: "draft-o", name: "N", kind: "table", config: {}, nodeStepClientId: "draft-s" },
      { clientId: "draft-p", name: "P", kind: "table", config: {}, nodeStepId: "a" },
    ]);
  });
});

describe("draftMerge against the server's mergeConfig (parity fixture, HEL-1733 D7)", () => {
  it.each(parity.merges)("$name", ({ stored, patch, merged }) => {
    expect(draftMerge(stored as Record<string, unknown>, patch as Record<string, unknown>)).toEqual(
      merged,
    );
  });
});
