// HEL-1733 (design.md D3/D8): the routed Output, shape and aggregate-tail handlers. A draft records ops (one overlay update each);
// with no draft each falls back to its immediate handler; a temp (`step-N`) target is refused and never recorded.

import { renderHook } from "@testing-library/react";

import { replayOverlay, withOps, EMPTY_OVERLAY } from "../state/pipelineDraft";
import { toDraftOutputs } from "../state/pipelineDraft";
import { pipelineStepToStep } from "../state/stepNarrowing";
import type { ExpandPipelineShapeResponse } from "../types/pipelineShape";
import type { PipelineRoot } from "../types/pipelineStep";
import { makeOutput, threeSteps } from "../ui/pipelineSpineTestKit";
import type { PipelineDraft } from "./usePipelineDraft";
import { usePipelineDraftRouting } from "./usePipelineDraftRouting";

const steps = threeSteps().map(pipelineStepToStep);
const root = (id: string): PipelineRoot => ({ id, dataSourceId: `src-${id}`, dataSourceName: id });

function setup(hasDraft: boolean, roots: PipelineRoot[] = [root("r1")]) {
  const draft = {
    hasDraft,
    createOutput: jest.fn(),
    editOutput: jest.fn(),
    deleteOutput: jest.fn(),
    appendOps: jest.fn(),
    setConfig: jest.fn(),
    setEnabled: jest.fn(),
    deleteStep: jest.fn(),
    insertStep: jest.fn(),
    addLaneStep: jest.fn(),
    duplicateStep: jest.fn(),
    reorderTrunk: jest.fn(),
  } as unknown as PipelineDraft;
  const handlers = {
    handleTempStepConfigChange: jest.fn(),
    handleRemoveSavedStep: jest.fn(),
    handleToggleTempStepEnabled: jest.fn(),
    handleAddStepNow: jest.fn(),
    handleInsertStepNow: jest.fn(),
    handleAddLaneStepNow: jest.fn(),
    handleDuplicateStepNow: jest.fn(),
    handleReorderStepsNow: jest.fn(),
    handleInstantiateShapeNow: jest.fn().mockResolvedValue(undefined),
    handleAddOutputViaAggregateTailNow: jest.fn(),
    outputActionsNow: { create: jest.fn(), update: jest.fn(), remove: jest.fn() },
  };
  const { result } = renderHook(() =>
    usePipelineDraftRouting({ draft, roots, draftSteps: steps, handlers }),
  );
  return { draft, handlers, routed: result.current };
}

describe("routed Output handlers", () => {
  it("record a created Output on a step, and on the ONLY root when no step is named", () => {
    const { draft, routed } = setup(true);
    routed.handleCreateOutput({ nodeStepId: "s1", kind: "table", name: " N ", config: {} });
    expect(draft.createOutput).toHaveBeenCalledWith({ step: "s1" }, "table", "N", {});
    routed.handleCreateOutput({ kind: "table", name: "R", config: {} });
    expect(draft.createOutput).toHaveBeenLastCalledWith({ root: "r1" }, "table", "R", {});
  });

  it("refuse a temp step target and a root target of a multi-root pipeline, recording nothing", () => {
    const one = setup(true);
    expect(() =>
      one.routed.handleCreateOutput({
        nodeStepId: "step-3",
        kind: "table",
        name: "x",
        config: {},
      }),
    ).toThrow(/Save the new step/);
    const many = setup(true, [root("r1"), root("r2")]);
    expect(() => many.routed.handleCreateOutput({ kind: "table", name: "x", config: {} })).toThrow(
      /several sources/,
    );
    expect(one.draft.createOutput).not.toHaveBeenCalled();
    expect(many.draft.createOutput).not.toHaveBeenCalled();
  });

  it("record an edit as the WHOLE merged config (the patch laid over the current draft config, a null kept)", () => {
    const { draft, routed } = setup(true);
    const output = makeOutput("o1", "One", { config: { a: 1, b: 2 } });
    routed.handleUpdateOutput(output, { name: " Two ", config: { b: null, c: 3 } });
    expect(draft.editOutput).toHaveBeenCalledWith("o1", {
      name: "Two",
      config: { a: 1, b: null, c: 3 },
    });
    expect(() => routed.handleUpdateOutput(output, { name: "  " })).toThrow(/needs a name/);
  });

  it("record a delete", () => {
    const { draft, routed } = setup(true);
    routed.handleDeleteOutput(makeOutput("o1", "One"));
    expect(draft.deleteOutput).toHaveBeenCalledWith("o1");
  });
});

describe("routed Output handlers with no draft fall back to the immediate writes", () => {
  it("create, update and delete go to the immediate actions and record nothing", () => {
    const { draft, handlers, routed } = setup(false);
    const output = makeOutput("o1", "One");
    routed.handleCreateOutput({ nodeStepId: "s1", kind: "table", name: "N", config: {} });
    routed.handleUpdateOutput(output, { name: "Two" });
    routed.handleDeleteOutput(output);
    expect(handlers.outputActionsNow.create).toHaveBeenCalledTimes(1);
    expect(handlers.outputActionsNow.update).toHaveBeenCalledWith(output, { name: "Two" });
    expect(handlers.outputActionsNow.remove).toHaveBeenCalledWith(output);
    expect(draft.createOutput).not.toHaveBeenCalled();
    expect(draft.editOutput).not.toHaveBeenCalled();
    expect(draft.deleteOutput).not.toHaveBeenCalled();
  });
});

describe("routed shape", () => {
  const expansion: ExpandPipelineShapeResponse = {
    steps: [
      { clientId: "step-0", kind: "select", config: { fields: ["a"] } },
      { clientId: "step-1", kind: "limit", config: { count: 5 }, parentStepId: "step-0" },
    ],
    outputs: [{ nodeStepId: "step-1", kind: "table", name: "Shape out", config: {} }],
  } as ExpandPipelineShapeResponse;

  it("falls back to the immediate handler with no draft", async () => {
    const { handlers, draft, routed } = setup(false);
    await routed.handleInstantiateShape(expansion, "s3");
    expect(handlers.handleInstantiateShapeNow).toHaveBeenCalledWith(expansion, "s3");
    expect(draft.appendOps).not.toHaveBeenCalled();
  });

  it("records ONE update: fresh draft ids (never the expansion's step-N), chained anchors, then the Output on the minted step; the save body names it", async () => {
    const { draft, routed } = setup(true);
    await routed.handleInstantiateShape(expansion, "s3");
    expect(draft.appendOps).toHaveBeenCalledTimes(1);
    const ops = (draft.appendOps as jest.Mock).mock.calls[0][0];
    expect(ops.map((o: { kind: string }) => o.kind)).toEqual(["insert", "insert", "outputCreate"]);
    expect(ops[0].anchor).toEqual({ after: "s3" });
    expect(ops[1].anchor).toEqual({ after: ops[0].clientId });
    expect(ops.every((o: { clientId: string }) => o.clientId.startsWith("draft-"))).toBe(true);
    expect(ops[2].node).toEqual({ step: ops[1].clientId });
    expect(ops[2].name).toBe("Shape out");

    const overlay = withOps(steps, EMPTY_OVERLAY, ops, false, []);
    const replay = replayOverlay(steps, overlay, []);
    expect(replay.dropped).toBe(0);
    expect(toDraftOutputs(replay.outputs ?? [], replay.steps, "r1")).toEqual([
      expect.objectContaining({ clientId: ops[2].clientId, nodeStepClientId: ops[1].clientId }),
    ]);
  });

  it("appends to the first root when the pipeline has no anchor, and ignores a temp anchor", async () => {
    const { draft, routed } = setup(true);
    await routed.handleInstantiateShape(expansion, undefined);
    expect((draft.appendOps as jest.Mock).mock.calls[0][0][0].anchor).toEqual({ append: "r1" });
    await routed.handleInstantiateShape(expansion, "step-9");
    expect(draft.appendOps).toHaveBeenCalledTimes(1);
  });
});

describe("routed aggregate tail", () => {
  const agg = { groupBy: ["a"], aggregations: [] } as never;
  const payload = { kind: "chart", name: " Tail ", config: { fieldMapping: {} } };

  it("falls back to the immediate handler with no draft", () => {
    const { handlers, routed } = setup(false);
    void routed.handleAddOutputViaAggregateTail("s1", agg, payload);
    expect(handlers.handleAddOutputViaAggregateTailNow).toHaveBeenCalledWith("s1", agg, payload);
  });

  it("records a lane op and an Output on it in ONE update", async () => {
    const { draft, routed } = setup(true);
    const created = await routed.handleAddOutputViaAggregateTail("s1", agg, payload);
    expect(draft.appendOps).toHaveBeenCalledTimes(1);
    const [lane, create] = (draft.appendOps as jest.Mock).mock.calls[0][0];
    expect(lane).toMatchObject({ kind: "lane", type: "aggregate", parent: "s1" });
    expect(create).toMatchObject({
      kind: "outputCreate",
      node: { step: lane.clientId },
      name: "Tail",
    });
    expect(created.id).toBe(create.clientId);
  });

  it("refuses a temp parent", async () => {
    const { draft, routed } = setup(true);
    await expect(routed.handleAddOutputViaAggregateTail("step-1", agg, payload)).rejects.toThrow(
      /Save the new step/,
    );
    expect(draft.appendOps).not.toHaveBeenCalled();
  });
});
