import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";

import { OP_TYPES } from "../state/stepNarrowing";
import { buildLaneGraph } from "../state/stepTree";
import type { Step } from "../types/step";
import { defaultSelectedStepId, selectAfterRemoval, useStepSelection } from "./useStepSelection";

const OP = OP_TYPES.find((op) => op.id === "filter")!;
const ROOTS = [{ id: "r1" }];

function step(id: string, parentStepId?: string, position?: number): Step {
  return {
    id,
    opType: OP,
    label: id,
    config: { combinator: "and", conditions: [] },
    enabled: true,
    parentStepId,
    position,
    rootId: parentStepId ? undefined : "r1",
  };
}

function render(initial: string, initialSteps: Step[], stepsLoaded = true) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
  );
  return renderHook(
    ({ steps, loaded }: { steps: Step[]; loaded: boolean }) => {
      const laneGraph = buildLaneGraph(steps, ROOTS);
      const selection = useStepSelection({
        steps,
        laneGraph,
        firstRootId: "r1",
        stepsLoaded: loaded,
      });
      const location = useLocation();
      return { ...selection, search: location.search };
    },
    { wrapper, initialProps: { steps: initialSteps, loaded: stepsLoaded } },
  );
}

const THREE = [step("a"), step("b", "a", 0), step("c", "b", 0)];

describe("useStepSelection", () => {
  it("defaults to the first step of root 0's trunk and to none when there are no steps", () => {
    expect(render("/p", THREE).result.current.selectedStepId).toBe("a");
    expect(render("/p", []).result.current.selectedStepId).toBeNull();
  });

  it("reads ?step= and falls back to the default for an unknown id", () => {
    expect(render("/p?step=c", THREE).result.current.selectedStepId).toBe("c");
    expect(render("/p?step=nope", THREE).result.current.selectedStepId).toBe("a");
  });

  it("writes ?step= with replace and keeps ?outputId=", () => {
    const { result } = render("/p?outputId=o1", THREE);
    act(() => result.current.selectStep("b"));
    expect(result.current.selectedStepId).toBe("b");
    const params = new URLSearchParams(result.current.search);
    expect(params.get("step")).toBe("b");
    expect(params.get("outputId")).toBe("o1");
  });

  it("selects a step created after the first load, but not the first loaded list", () => {
    const { result, rerender } = render("/p", [], false);
    rerender({ steps: THREE, loaded: true });
    expect(result.current.selectedStepId).toBe("a");
    rerender({ steps: [...THREE, step("d", "c", 0)], loaded: true });
    expect(result.current.selectedStepId).toBe("d");
  });

  it("follows the temp-id to server-id swap of a created step", () => {
    const { result, rerender } = render("/p", THREE);
    rerender({ steps: [...THREE, step("step-9", "c", 0)], loaded: true });
    expect(result.current.selectedStepId).toBe("step-9");
    const swapped = { ...step("real-9", "c", 0), renderKey: "step-9" };
    rerender({ steps: [...THREE, swapped], loaded: true });
    expect(result.current.selectedStepId).toBe("real-9");
  });
});

describe("selectAfterRemoval / defaultSelectedStepId", () => {
  const graph = buildLaneGraph(THREE, ROOTS);
  it("picks the predecessor in the same lane", () => {
    expect(selectAfterRemoval(graph, "c", "r1")).toBe("b");
  });
  it("picks the first remaining step when the first step is removed", () => {
    expect(selectAfterRemoval(graph, "a", "r1")).toBe("b");
  });
  it("picks the branch point when the removed step heads a branch lane", () => {
    const branched = buildLaneGraph([...THREE, step("x", "a", 1)], ROOTS);
    expect(selectAfterRemoval(branched, "x", "r1")).toBe("a");
  });
  it("default is undefined for an empty graph", () => {
    expect(defaultSelectedStepId(buildLaneGraph([], ROOTS), "r1")).toBeUndefined();
  });
});
