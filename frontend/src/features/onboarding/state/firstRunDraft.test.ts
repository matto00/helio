import { buildRefineDraft, canRefineWithAssistant } from "./firstRunDraft";

describe("first-run refine draft (HEL-1209)", () => {
  it("names the new source and pipeline by name and id, and ends open for the user", () => {
    const draft = buildRefineDraft({
      dashboardId: "d-1",
      dashboardName: "Sales dash",
      panelCount: 3,
      pipelineId: "p-1",
      pipelineName: "Sales pipeline",
      sourceId: "s-1",
      sourceName: "Sales",
    });

    expect(draft).toContain('"Sales" (source id s-1)');
    expect(draft).toContain('"Sales pipeline" (id p-1)');
    expect(draft).toContain('"Sales dash" (id d-1)');
    expect(draft.endsWith(": ")).toBe(true);
  });

  it.each([
    ["beta", true],
    ["owner", true],
    ["free", false],
    [undefined, false],
  ])("canRefineWithAssistant(%s) is %s", (tier, expected) => {
    expect(canRefineWithAssistant(tier)).toBe(expected);
  });
});
