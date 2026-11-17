import { buildAnalyzeProposalRequest, schemaAtNode } from "./draftNodeSchema";
import { pipelineStepToStep } from "./stepNarrowing";
import type { PipelineRoot, PipelineStep } from "../types/pipelineStep";
import type { Step } from "../types/step";

const roots: PipelineRoot[] = [{ id: "r1", dataSourceId: "src-1", dataSourceName: "S" }];

function step(
  id: string,
  parent: string | null,
  over: { enabled?: boolean; position?: number } = {},
): Step {
  return pipelineStepToStep({
    id,
    pipelineId: "p",
    position: over.position ?? 0,
    createdAt: "",
    updatedAt: "",
    type: "limit",
    config: { count: 1 },
    enabled: over.enabled ?? true,
    parentStepId: parent,
    rootId: parent === null ? "r1" : null,
  } as PipelineStep);
}

describe("buildAnalyzeProposalRequest", () => {
  it("sends every step's enabled flag (a disabled one too), the pipeline name and the roots, and no temp step", () => {
    const req = buildAnalyzeProposalRequest("My pipe", roots, [
      step("a", null),
      step("b", "a", { enabled: false }),
      step("step-1", "b"),
    ]);
    expect(req.pipelineName).toBe("My pipe");
    expect(req.roots).toEqual([{ sourceId: "src-1", clientId: "r1" }]);
    expect(req.steps.map((s) => [s.clientId, s.enabled])).toEqual([
      ["a", true],
      ["b", false],
    ]);
    expect(req.steps[0]).toMatchObject({ rootClientId: "r1" });
    expect(req.steps[1]).toMatchObject({ parentStepId: "a" });
  });

  it("re-points a real step under a temp step to the temp step's nearest real ancestor, or to its root", () => {
    const req = buildAnalyzeProposalRequest("p", roots, [
      step("a", null),
      step("step-1", "a"),
      step("c", "step-1"),
      step("step-2", null),
      step("d", "step-2"),
    ]);
    const by = Object.fromEntries(req.steps.map((s) => [s.clientId, s]));
    expect(by.c.parentStepId).toBe("a");
    expect(by.d.parentStepId).toBeUndefined();
    expect(by.d.rootClientId).toBe("r1");
  });

  it("orders by position so a lane (position >= 1) never precedes the trunk step it branches from", () => {
    const req = buildAnalyzeProposalRequest("p", roots, [
      step("a", null),
      step("lane", "a", { position: 1 }),
      step("trunk", "a", { position: 0 }),
    ]);
    expect(req.steps.map((s) => s.clientId)).toEqual(["a", "trunk", "lane"]);
  });
});

describe("schemaAtNode", () => {
  const response = {
    sourceSchemas: [
      { rootId: "r1", dataSourceName: "S", sourceSchema: [{ name: "src", type: "string" }] },
    ],
    steps: [{ id: "a", outputSchema: [{ name: "x", type: "integer" }] }],
  };

  it("reads the node's own output schema", () => {
    expect(schemaAtNode(response, [step("a", null)], "a")).toEqual([
      { name: "x", type: "integer" },
    ]);
  });

  it("(f) a node the draft disabled (absent from the response) takes its nearest enabled ancestor's schema", () => {
    const draft = [step("a", null), step("b", "a", { enabled: false })];
    expect(schemaAtNode(response, draft, "b")).toEqual([{ name: "x", type: "integer" }]);
  });

  it("with no enabled ancestor, a disabled node takes its root's source schema", () => {
    expect(
      schemaAtNode({ ...response, steps: [] }, [step("a", null, { enabled: false })], "a"),
    ).toEqual([{ name: "src", type: "string" }]);
  });

  it("is null for a node that is not in the draft", () => {
    expect(schemaAtNode(response, [step("a", null)], "zzz")).toBeNull();
  });
});
