import { VIEWER_COPY, copyFor } from "./viewerCopy";

// HEL-1794 (design.md D3): every viewer variant, with the editor/owner string beside it. The no-selection description is only reachable
// through the layout while the selection is unresolved (a transient the page never rests in), so it is pinned here.
describe("viewer copy table", () => {
  it("pins the no-selection description for a viewer and an editor", () => {
    expect(copyFor(VIEWER_COPY.editorPickDescription, false)).toBe(
      "Pick a step on the left to see its configuration and the rows it produces.",
    );
    expect(copyFor(VIEWER_COPY.editorPickDescription, true)).toBe(
      "Pick a step on the left to edit it and see the rows it produces.",
    );
  });

  it("no viewer variant invites an edit or a run, and every one differs from the editor's", () => {
    for (const entry of Object.values(VIEWER_COPY)) {
      expect(entry.viewer).not.toBe(entry.edit);
      expect(entry.viewer).not.toMatch(/\b(add|edit|run the)\b/i);
    }
  });
});
