// HEL-1794 (design.md D2): with editable: false every routed edit handler returns at once: no immediate write, no draft op.

import { renderHook } from "@testing-library/react";

import { pipelineStepToStep } from "../state/stepNarrowing";
import { threeSteps } from "../ui/pipelineSpineTestKit";
import { OP_TYPES } from "../state/stepNarrowing";
import type { PipelineRoot } from "../types/pipelineStep";
import type { PipelineDraft } from "./usePipelineDraft";
import { usePipelineDraftRouting } from "./usePipelineDraftRouting";

const steps = threeSteps().map(pipelineStepToStep);
const roots: PipelineRoot[] = [{ id: "r1", dataSourceId: "src", dataSourceName: "Orders" }];

function setup(editable: boolean, hasDraft: boolean) {
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
    addRoot: jest.fn(),
    removeRoot: jest.fn(),
  } as unknown as PipelineDraft;
  const handlers = {
    handleAddRootNow: jest.fn().mockResolvedValue(undefined),
    handleRemoveRootNow: jest.fn().mockResolvedValue(undefined),
    handleTempStepConfigChange: jest.fn(),
    handleRemoveSavedStep: jest.fn(),
    handleToggleTempStepEnabled: jest.fn().mockResolvedValue(undefined),
    handleAddStepNow: jest.fn(),
    handleInsertStepNow: jest.fn().mockResolvedValue(undefined),
    handleAddLaneStepNow: jest.fn().mockResolvedValue(undefined),
    handleDuplicateStepNow: jest.fn(),
    handleReorderStepsNow: jest.fn(),
    handleInstantiateShapeNow: jest.fn().mockResolvedValue(undefined),
    handleAddOutputViaAggregateTailNow: jest.fn(),
    outputActionsNow: { create: jest.fn(), update: jest.fn(), remove: jest.fn() },
  };
  const { result } = renderHook(() =>
    usePipelineDraftRouting({ draft, roots, draftSteps: steps, sources: [], handlers, editable }),
  );
  return { draft, handlers, routed: result.current };
}

const op = OP_TYPES.find((o) => o.id === "filter")!;
const calls = (...fns: unknown[]) => fns.map((f) => (f as jest.Mock).mock.calls.length);

describe.each([false, true])(
  "usePipelineDraftRouting with editable: false (hasDraft %s)",
  (hasDraft) => {
    it("fires no write and records no op for any edit handler", async () => {
      const { draft, handlers, routed } = setup(false, hasDraft);
      routed.handleAddRoot("ds9");
      routed.handleRemoveRoot("r1");
      routed.handleStepConfigChange("s1", {} as never);
      routed.handleStepConfigChange("step-1", {} as never);
      routed.handleRemoveStep("s1");
      routed.handleRemoveStep("step-1");
      await routed.handleToggleStepEnabled("s1", false);
      await routed.handleToggleStepEnabled("step-1", false);
      routed.handleAddStep(op);
      await routed.handleInsertStep(op, 1);
      await routed.handleAddLaneStep(op, "s1");
      routed.handleDuplicateStep("s1");
      routed.handleReorderSteps([...steps].reverse());
      routed.handleCreateOutput({ nodeStepId: "s1", kind: "table", name: "N", config: {} });
      routed.handleUpdateOutput({ id: "o1", name: "x", config: {} } as never, { name: "y" });
      routed.handleDeleteOutput({ id: "o1" } as never);
      await routed.handleInstantiateShape({ steps: [], outputs: [] } as never, "s1");
      await Promise.resolve(
        routed.handleAddOutputViaAggregateTail("s1", {} as never, {
          kind: "table",
          name: "N",
          config: {},
        }),
      ).catch(() => undefined);
      expect(
        Object.values(handlers).flatMap((h) => (typeof h === "function" ? calls(h) : [])),
      ).toEqual(
        Object.values(handlers)
          .filter((h) => typeof h === "function")
          .map(() => 0),
      );
      expect(
        calls(
          handlers.outputActionsNow.create,
          handlers.outputActionsNow.update,
          handlers.outputActionsNow.remove,
        ),
      ).toEqual([0, 0, 0]);
      for (const f of Object.values(draft))
        if (typeof f === "function") expect((f as jest.Mock).mock.calls).toHaveLength(0);
    });
  },
);

describe("usePipelineDraftRouting with editable: true", () => {
  it("still routes an edit (control)", () => {
    const { draft, routed } = setup(true, true);
    routed.handleStepConfigChange("s1", {} as never);
    expect(draft.setConfig).toHaveBeenCalledTimes(1);
  });
});
