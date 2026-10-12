import { render, screen } from "@testing-library/react";

import { OutputEditorFooter } from "./OutputEditorFooter";

// HEL-1490 item 4 -- one "save blocked" prop covers every trigger (invalid rules, bin count, reference marks).
function renderFooter(extra: { saveBlocked?: boolean; saving?: boolean } = {}) {
  render(
    <OutputEditorFooter
      isCreate
      confirmingDelete={false}
      onDeleteClick={jest.fn()}
      placements={null}
      saving={extra.saving ?? false}
      onClose={jest.fn()}
      canAddTailWithAggregate={false}
      onAddTailWithAggregate={jest.fn()}
      onSave={jest.fn()}
      saveBlocked={extra.saveBlocked}
    />,
  );
}

describe("OutputEditorFooter save gating", () => {
  it("enables Save by default", () => {
    renderFooter();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("disables Save when saveBlocked is set", () => {
    renderFooter({ saveBlocked: true });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("disables Save while saving", () => {
    renderFooter({ saving: true });
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  });
});
