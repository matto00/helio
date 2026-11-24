import { VIEWER_COPY, copyFor } from "./viewerCopy";

// HEL-1794 (design.md D3): the first test pins one entry (the no-selection description) as a viewer string and an editor string, because
// that description is only reachable through the layout while the selection is unresolved (a transient the page never rests in).
// The second walks EVERY entry and asserts the viewer variant differs from the editor/owner one and does not invite an edit or a run;
// the invitation check is a regex, so it only catches the words "add", "edit" and "run the".
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
