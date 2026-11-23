import { canEditFromUi, type PipelineRunRole } from "./usePipelineRunRole";

// HEL-1794 (design.md D1): the page offers edit affordances to an owner and an editor only; a viewer and a role that is not yet
// known (`pending`) get none.
describe("canEditFromUi", () => {
  it.each<[PipelineRunRole, boolean]>([
    ["owner", true],
    ["editor", true],
    ["viewer", false],
    ["pending", false],
  ])("%s -> %s", (role, expected) => {
    expect(canEditFromUi(role)).toBe(expected);
  });
});
