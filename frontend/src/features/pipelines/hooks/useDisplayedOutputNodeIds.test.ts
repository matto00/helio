import { renderHook } from "@testing-library/react";

import type { Output } from "../types/output";
import { useDisplayedOutputNodeIds } from "./useDisplayedOutputNodeIds";

const out = (id: string, nodeStepId?: string): Output =>
  ({ id, nodeStepId, rootId: nodeStepId === undefined ? "r1" : undefined }) as unknown as Output;
const OUTPUTS = [out("o1", "s1"), out("o2", "s2"), out("root")];

describe("useDisplayedOutputNodeIds", () => {
  it("names the node of the Output the selected step resolves to", () => {
    const { result } = renderHook(() => useDisplayedOutputNodeIds(OUTPUTS, null, "s2"));
    expect(result.current).toEqual(["s2"]);
  });

  it("follows an explicit pick of an Output whose node is not the selected step (the phone's Preview step)", () => {
    const { result } = renderHook(() =>
      useDisplayedOutputNodeIds(OUTPUTS, { id: "o2", forStep: "s1" }, "s1"),
    );
    expect(result.current).toEqual(["s2"]);
  });

  it("ignores a pick made for another step, and names nothing for a root-bound Output", () => {
    expect(
      renderHook(() => useDisplayedOutputNodeIds(OUTPUTS, { id: "o2", forStep: "s9" }, "s1")).result
        .current,
    ).toEqual(["s1"]);
    expect(
      renderHook(() => useDisplayedOutputNodeIds(OUTPUTS, { id: "root", forStep: "s1" }, "s1"))
        .result.current,
    ).toEqual([]);
  });

  it("keeps one array identity while the id is the same", () => {
    const { result, rerender } = renderHook(
      ({ step }) => useDisplayedOutputNodeIds(OUTPUTS, null, step),
      { initialProps: { step: "s1" } },
    );
    const first = result.current;
    rerender({ step: "s1" });
    expect(result.current).toBe(first);
  });
});
