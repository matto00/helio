// HEL-1733 (design.md D15): the draft never judges Output ops against Outputs this page has not loaded, and the kept Outputs
// signature is judged exactly once per restore, before any Output drop is counted.

import { act, renderHook } from "@testing-library/react";

import { KEPT_DRAFT_PREFIX, readKeptDraft, writeKeptDraft } from "../state/keptDraft";
import {
  EMPTY_OVERLAY,
  baseSignature,
  outputsSignature,
  type DraftOverlay,
} from "../state/pipelineDraft";
import { pipelineStepToStep } from "../state/stepNarrowing";
import type { Output } from "../types/output";
import type { Step } from "../types/step";
import { makeOutput } from "../ui/pipelineSpineTestKit";
import { threeSteps } from "../ui/pipelineSpineTestKit";
import { usePipelineDraft, type OutputsStatus } from "./usePipelineDraft";

const steps = (): Step[] => threeSteps().map(pipelineStepToStep);
const o1 = makeOutput("o1", "One", { nodeStepId: "s2" });
const o2 = makeOutput("o2", "Two", { nodeStepId: "s1" });

interface Props {
  steps: Step[];
  outputs: Output[];
  status: OutputsStatus;
  ready: boolean;
}

function mount(initial: Props) {
  return renderHook(
    (p: Props) =>
      usePipelineDraft({
        baseSteps: p.steps,
        baseStepsRef: { current: p.steps },
        baseOutputs: p.outputs,
        outputsStatus: p.status,
        pipelineId: "pipe-1",
        ready: p.ready,
      }),
    { initialProps: initial },
  );
}

const overlayOf = (over: Partial<DraftOverlay>): DraftOverlay => ({ ...EMPTY_OVERLAY, ...over });
const keptOf = (overlay: DraftOverlay, outputs: Output[] | null, base = baseSignature(steps())) =>
  writeKeptDraft("pipe-1", {
    overlay,
    base,
    ...(outputs !== null ? { outputsBase: outputsSignature(outputs) } : {}),
  });
const storedOutputsBase = () => readKeptDraft("pipe-1")?.outputsBase;

beforeEach(() => window.sessionStorage.clear());

describe("kept Output ops wait for the page's own Outputs fetch (D15)", () => {
  it("(1) a step edit made between steps-ready and outputs-ready survives, and a kept outputDelete/outputEdits applies once Outputs load: droppedCount 0, not stale", () => {
    keptOf(
      overlayOf({
        ops: [{ kind: "outputDelete", outputId: "o1" }],
        outputEdits: { o2: { name: "Two!", config: {} } },
      }),
      [o1, o2],
    );
    const s = steps();
    const { result, rerender } = mount({ steps: s, outputs: [], status: "loading", ready: true });
    // Steps are ready, Outputs are not: the kept ops are carried untouched, nothing counted.
    expect(result.current.hasDraft).toBe(true);
    expect(result.current.droppedCount).toBe(0);
    act(() => result.current.setConfig("s1", { combinator: "and", conditions: [] }));
    expect(result.current.overlay.configs.s1).toBeDefined();
    expect(result.current.overlay.ops).toHaveLength(1);

    rerender({ steps: s, outputs: [o1, o2], status: "loaded", ready: true });
    expect(result.current.staleRestored).toBe(false);
    expect(result.current.droppedCount).toBe(0);
    expect(result.current.draftOutputs.map((o) => o.name)).toEqual(["Two!"]);
    expect(result.current.overlay.configs.s1).toBeDefined();
  });

  it("(2) a kept outputsBase that differs from the loaded Outputs restores stale", () => {
    keptOf(overlayOf({ ops: [{ kind: "outputDelete", outputId: "o1" }] }), [o1]);
    const s = steps();
    const { result, rerender } = mount({ steps: s, outputs: [], status: "loading", ready: true });
    rerender({ steps: s, outputs: [o1, o2], status: "loaded", ready: true });
    expect(result.current.staleRestored).toBe(true);
  });

  it("(3) a failed Outputs list keeps every Output op and the ORIGINAL kept outputsBase; a later successful load that differs is stale", () => {
    keptOf(overlayOf({ ops: [{ kind: "outputDelete", outputId: "o1" }] }), [o1]);
    const s = steps();
    const failed = mount({ steps: s, outputs: [], status: "failed", ready: true });
    expect(failed.result.current.overlay.ops).toHaveLength(1);
    expect(failed.result.current.droppedCount).toBe(0);
    expect(storedOutputsBase()).toBe(outputsSignature([o1]));
    failed.unmount();

    const again = mount({ steps: s, outputs: [], status: "loading", ready: true });
    again.rerender({ steps: s, outputs: [o1, o2], status: "loaded", ready: true });
    expect(again.result.current.staleRestored).toBe(true);
  });

  it("(4) a differing outputsBase AND a kept outputDelete of a server-deleted Output: stale, the op retained, droppedCount 0, and 1 after Reload", () => {
    keptOf(overlayOf({ ops: [{ kind: "outputDelete", outputId: "gone" }] }), [
      o1,
      makeOutput("gone", "Gone"),
    ]);
    const s = steps();
    const { result, rerender } = mount({ steps: s, outputs: [], status: "loading", ready: true });
    rerender({ steps: s, outputs: [o1], status: "loaded", ready: true });
    expect(result.current.staleRestored).toBe(true);
    expect(result.current.overlay.ops).toHaveLength(1);
    expect(result.current.droppedCount).toBe(0);
    let dropped = 0;
    act(() => {
      dropped = result.current.rebase(s, [o1]);
    });
    expect(dropped).toBe(1);
  });

  it("(5) a Back with the previous visit's list still in Redux does not judge before this page's fetch completes", () => {
    keptOf(overlayOf({ ops: [{ kind: "outputDelete", outputId: "o1" }] }), [o1]);
    const s = steps();
    // The old list is present (and differs) but the page's own status is still "loading".
    const { result, rerender } = mount({ steps: s, outputs: [o2], status: "loading", ready: true });
    expect(result.current.staleRestored).toBe(false);
    expect(result.current.droppedCount).toBe(0);
    rerender({ steps: s, outputs: [o1], status: "loaded", ready: true });
    expect(result.current.staleRestored).toBe(false);
    expect(result.current.droppedCount).toBe(0);
  });

  it("(6) a later refetch does not judge again", () => {
    keptOf(overlayOf({ ops: [{ kind: "outputDelete", outputId: "o1" }] }), [o1]);
    const s = steps();
    const { result, rerender } = mount({ steps: s, outputs: [], status: "loading", ready: true });
    rerender({ steps: s, outputs: [o1], status: "loaded", ready: true });
    expect(result.current.staleRestored).toBe(false);
    // Someone else changed the Outputs afterwards: a new list, status still "loaded".
    rerender({ steps: s, outputs: [o1, o2], status: "loaded", ready: true });
    expect(result.current.staleRestored).toBe(false);
  });

  it("(7) Outputs load BEFORE steps-ready and the kept outputsBase differs: stale, and the kept copy still holds the ORIGINAL outputsBase", () => {
    keptOf(overlayOf({ ops: [{ kind: "outputDelete", outputId: "o1" }] }), [o1]);
    const s = steps();
    const { result, rerender } = mount({
      steps: s,
      outputs: [o1, o2],
      status: "loaded",
      ready: false,
    });
    expect(result.current.hasDraft).toBe(false);
    rerender({ steps: s, outputs: [o1, o2], status: "loaded", ready: true });
    expect(result.current.staleRestored).toBe(true);
    expect(result.current.droppedCount).toBe(0);
    expect(storedOutputsBase()).toBe(outputsSignature([o1]));
  });

  it("(8) the same order with an equal outputsBase is not stale, and is judged once", () => {
    keptOf(overlayOf({ ops: [{ kind: "outputDelete", outputId: "o1" }] }), [o1, o2]);
    const s = steps();
    const { result, rerender } = mount({
      steps: s,
      outputs: [o1, o2],
      status: "loaded",
      ready: false,
    });
    rerender({ steps: s, outputs: [o1, o2], status: "loaded", ready: true });
    expect(result.current.staleRestored).toBe(false);
    expect(result.current.draftOutputs.map((o) => o.id)).toEqual(["o2"]);
    // Equal: the kept signature is released, so later writes track the current base.
    rerender({ steps: s, outputs: [o1], status: "loaded", ready: true });
    expect(storedOutputsBase()).toBe(outputsSignature([o1]));
  });
});

describe("a kept v1/v2 draft is compared on steps only (D11)", () => {
  it("restores a draft with no outputsBase as NOT stale and starts writing the current one", () => {
    keptOf(overlayOf({ configs: { s1: { combinator: "and", conditions: [] } } as never }), null);
    expect(window.sessionStorage.getItem(KEPT_DRAFT_PREFIX + "pipe-1")).not.toBeNull();
    const s = steps();
    const { result } = mount({ steps: s, outputs: [o1], status: "loaded", ready: true });
    expect(result.current.staleRestored).toBe(false);
    expect(storedOutputsBase()).toBe(outputsSignature([o1]));
  });
});
