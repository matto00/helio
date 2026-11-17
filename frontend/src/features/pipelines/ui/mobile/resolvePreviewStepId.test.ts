import { resolvePreviewStepId } from "./MobilePreviewTab";
import type { LaneGraph } from "../../state/stepTree";

// HEL-1705 (design.md D8e): the Preview tab's step and the displayed Output's step are one function.
const graph = (...laneSteps: string[][]): LaneGraph =>
  ({
    lanes: laneSteps.map((ids, i) => ({
      id: `lane${i}`,
      parentStepId: i === 0 ? undefined : "x",
      rootId: i === 0 ? "r1" : undefined,
      steps: ids.map((id) => ({ id })),
    })),
  }) as unknown as LaneGraph;
const ROOTS = [{ id: "r1", dataSourceId: "d", dataSourceName: "d" }];

describe("resolvePreviewStepId", () => {
  it("is the pick when it is a step, else the first trunk's last step, else the first step", () => {
    const g = graph(["a", "b", "c"], ["d"]);
    expect(resolvePreviewStepId(g, ROOTS, "d")).toBe("d");
    expect(resolvePreviewStepId(g, ROOTS, null)).toBe("c");
    expect(resolvePreviewStepId(g, ROOTS, "gone")).toBe("c");
    expect(resolvePreviewStepId(graph(["a"]), [], null)).toBe("a");
  });

  it("is null with no steps", () => {
    expect(resolvePreviewStepId(graph([]), ROOTS, null)).toBeNull();
  });
});
