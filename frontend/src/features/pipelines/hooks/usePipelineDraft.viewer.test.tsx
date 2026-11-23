// HEL-1794 (design.md D2): the draft overlay's mutators are no-ops when the page is not editable; discard, the kept-draft restore
// and the re-base are never guarded (a draft that exists for a viewer is shown and can be discarded: owner ruling HEL-1661 Q2).

import { act, renderHook } from "@testing-library/react";

import { KEPT_DRAFT_PREFIX, readKeptDraft, writeKeptDraft } from "../state/keptDraft";
import { EMPTY_OVERLAY, baseSignature, type DraftOverlay } from "../state/pipelineDraft";
import { pipelineStepToStep } from "../state/stepNarrowing";
import { threeSteps } from "../ui/pipelineSpineTestKit";
import { usePipelineDraft } from "./usePipelineDraft";

const steps = threeSteps().map(pipelineStepToStep);

function mount(editable: boolean) {
  return renderHook(() =>
    usePipelineDraft({
      baseSteps: steps,
      baseStepsRef: { current: steps },
      baseOutputs: [],
      outputsStatus: "loaded",
      pipelineId: "pipe-1",
      ready: true,
      editable,
    }),
  );
}

beforeEach(() => window.sessionStorage.clear());

describe("usePipelineDraft with editable: false", () => {
  it("every mutator leaves hasDraft false and writes no kept draft", () => {
    const { result } = mount(false);
    act(() => {
      result.current.setConfig("s1", { combinator: "and", conditions: [] } as never);
      result.current.setEnabled("s1", false);
      result.current.deleteStep("s2");
      result.current.insertStep("filter", { combinator: "and", conditions: [] } as never, {
        append: "root-1",
      });
      result.current.addLaneStep("filter", { combinator: "and", conditions: [] } as never, "s1");
      result.current.duplicateStep("s1");
      result.current.reorderTrunk("root-1", ["s2", "s1", "s3"]);
      result.current.createOutput({ step: "s1" }, "table", "N", {});
      result.current.editOutput("o1", { name: "x", config: {} });
      result.current.deleteOutput("o1");
      result.current.addRoot("ds", "Orders");
      result.current.removeRoot("root-1");
      result.current.appendOps([]);
    });
    expect(result.current.hasDraft).toBe(false);
    expect(result.current.draftSteps).toBe(steps);
    expect(window.sessionStorage.getItem(KEPT_DRAFT_PREFIX + "pipe-1")).toBeNull();
  });

  it("a kept draft is still restored for a viewer, and discard clears it", () => {
    const overlay: DraftOverlay = {
      ...EMPTY_OVERLAY,
      enabled: { s1: false },
    } as unknown as DraftOverlay;
    writeKeptDraft("pipe-1", { overlay, base: baseSignature(steps) });
    const { result } = mount(false);
    expect(result.current.hasDraft).toBe(true);
    act(() => result.current.discard());
    expect(result.current.hasDraft).toBe(false);
    expect(readKeptDraft("pipe-1")).toBeNull();
  });

  it("with editable: true a mutator still records a draft", () => {
    const { result } = mount(true);
    act(() => result.current.setEnabled("s1", false));
    expect(result.current.hasDraft).toBe(true);
  });
});
