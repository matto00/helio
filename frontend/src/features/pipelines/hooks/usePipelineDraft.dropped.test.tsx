// HEL-1684 (design.md D1/D8): when the saved steps change under a draft, an op whose steps are gone is pruned and counted once;
// a stale-restored draft keeps every op until "Reload the saved pipeline" has counted them.

import { act, renderHook } from "@testing-library/react";

import { writeKeptDraft } from "../state/keptDraft";
import { EMPTY_OVERLAY, baseSignature } from "../state/pipelineDraft";
import type { DraftOverlay } from "../state/pipelineDraft";
import { pipelineStepToStep } from "../state/stepNarrowing";
import type { Step } from "../types/step";
import { threeSteps } from "../ui/pipelineSpineTestKit";
import { usePipelineDraft } from "./usePipelineDraft";

const base = (): Step[] => threeSteps().map(pipelineStepToStep);
const insertAfterS2: DraftOverlay = {
  ...EMPTY_OVERLAY,
  ops: [
    {
      kind: "insert",
      clientId: "draft-1",
      type: "limit",
      config: { count: 1 },
      anchor: { after: "s2" },
    },
  ],
};

function mount(initial: Step[]) {
  return renderHook(
    ({ steps }: { steps: Step[] }) =>
      usePipelineDraft({
        baseSteps: steps,
        baseStepsRef: { current: steps },
        baseOutputs: [],
        outputsStatus: "loaded",
        pipelineId: "pipe-1",
        ready: true,
      }),
    { initialProps: { steps: initial } },
  );
}

beforeEach(() => window.sessionStorage.clear());

describe("saved steps change under a draft", () => {
  it("prunes an op whose anchor is gone and counts it once", () => {
    const steps = base();
    writeKeptDraft("pipe-1", { overlay: insertAfterS2, base: baseSignature(steps) });
    const { result, rerender } = mount(steps);
    expect(result.current.hasDraft).toBe(true);
    expect(result.current.droppedCount).toBe(0);

    rerender({ steps: steps.filter((s) => s.id !== "s2") });
    expect(result.current.droppedCount).toBe(1);
    expect(result.current.overlay.ops).toEqual([]);
    expect(result.current.hasDraft).toBe(false);
  });

  it("keeps every op of a stale-restored draft and prunes nothing", () => {
    const steps = base();
    writeKeptDraft("pipe-1", { overlay: insertAfterS2, base: "a different saved pipeline" });
    const { result, rerender } = mount(steps.filter((s) => s.id !== "s2"));
    expect(result.current.staleRestored).toBe(true);
    expect(result.current.overlay.ops).toHaveLength(1);
    rerender({ steps: steps.filter((s) => s.id !== "s2") });
    expect(result.current.droppedCount).toBe(0);
    expect(result.current.overlay.ops).toHaveLength(1);

    let dropped = 0;
    act(() => {
      dropped = result.current.rebase(
        steps.filter((s) => s.id !== "s2"),
        [],
      );
    });
    expect(dropped).toBe(1);
  });

  it("an edit to a stale-restored draft does not silently drop its non-applying ops", () => {
    const steps = base().filter((s) => s.id !== "s2");
    writeKeptDraft("pipe-1", { overlay: insertAfterS2, base: "a different saved pipeline" });
    const { result } = mount(steps);
    act(() => result.current.setEnabled("s1", false));
    expect(result.current.overlay.ops).toHaveLength(1);
  });
});
