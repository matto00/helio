import type { PipelineStep } from "../types/pipelineStep";
import type { Step } from "../types/step";
import { remapCreatedOutputs, savedStepForDraftStep } from "./draftSelection";
import { OP_TYPES } from "./stepNarrowing";

const limit = OP_TYPES.find((o) => o.id === "limit")!;
const draft = (id: string, over: Partial<Step>): Step => ({
  id,
  opType: limit,
  label: limit.label,
  config: { count: 1 },
  enabled: true,
  ...over,
});
const saved = (id: string, over: Partial<PipelineStep>): PipelineStep =>
  ({
    id,
    type: "limit",
    position: 0,
    config: { count: 1 },
    enabled: true,
    ...over,
  }) as PipelineStep;

describe("savedStepForDraftStep", () => {
  it("finds the saved step an inserted step became, among the children of its saved anchor", () => {
    const steps = [
      draft("a", { rootId: "r1" }),
      draft("draft-1", { parentStepId: "a", position: 0 }),
      draft("b", { parentStepId: "draft-1", position: 0 }),
    ];
    const after = [
      saved("a", { rootId: "r1" }),
      saved("n1", { parentStepId: "a" }),
      saved("b", { parentStepId: "n1" }),
    ];
    expect(savedStepForDraftStep(steps, "draft-1", after)).toBe("n1");
  });

  it("follows a chain of new steps and a head insert from the root", () => {
    const steps = [
      draft("draft-1", { rootId: "r1", position: 0 }),
      draft("draft-2", { parentStepId: "draft-1", position: 0 }),
      draft("a", { parentStepId: "draft-2", position: 0 }),
    ];
    const after = [
      saved("n1", { rootId: "r1" }),
      saved("n2", { parentStepId: "n1" }),
      saved("a", { parentStepId: "n2" }),
    ];
    expect(savedStepForDraftStep(steps, "draft-2", after)).toBe("n2");
  });

  it("falls back to the nearest saved ancestor when nothing matches", () => {
    const steps = [
      draft("a", { rootId: "r1" }),
      draft("draft-1", { parentStepId: "a", position: 1 }),
    ];
    expect(savedStepForDraftStep(steps, "draft-1", [saved("a", { rootId: "r1" })])).toBe("a");
  });
});

describe("remapCreatedOutputs (HEL-1733 D10)", () => {
  const out = (id: string, nodeStepId: string | undefined, name = "N", kind = "table") =>
    ({
      id,
      pipelineId: "p",
      ownerId: "u",
      name,
      kind,
      config: {},
      schema: [],
      createdAt: "",
      updatedAt: "",
      ...(nodeStepId !== undefined ? { nodeStepId } : {}),
    }) as never;

  it("maps a created Output to the new saved Output at the same node, kind and name, never one that was already there", () => {
    const created = out("draft-o", "s1", "N");
    const map = remapCreatedOutputs(
      [],
      [created, out("kept", "s1", "N")],
      new Set(["kept"]),
      [] as never,
      [out("kept", "s1", "N"), out("new-1", "s1", "N"), out("new-2", "s1", "Other")],
    );
    expect([...map.entries()]).toEqual([["draft-o", "new-1"]]);
  });

  it("has no entry for a created Output the save did not produce, so the default resolution applies", () => {
    const map = remapCreatedOutputs([], [out("draft-o", "s1")], new Set(), [] as never, []);
    expect(map.size).toBe(0);
  });
});
