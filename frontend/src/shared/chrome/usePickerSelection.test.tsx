import { fireEvent, screen } from "@testing-library/react";

import { renderWithStore } from "../../test/renderWithStore";
import { usePickerSelection } from "./usePickerSelection";

function Probe({ pathname }: { pathname: string }) {
  const selection = usePickerSelection(pathname);
  return (
    <div>
      <span data-testid="create-action-label">{selection.createAction?.cta.label ?? "none"}</span>
      <button
        type="button"
        onClick={() => selection.createAction?.cta.onClick()}
        disabled={selection.createAction === null}
      >
        {selection.createAction?.cta.label ?? "no create action"}
      </button>
    </div>
  );
}

describe("usePickerSelection — chat create-action parity (HEL-789's surviving half)", () => {
  it("Assistant now has a create action ('New chat'), matching desktop's SidebarBody parity", () => {
    renderWithStore(<Probe pathname="/chat" />);
    expect(screen.getByTestId("create-action-label")).toHaveTextContent("New chat");
  });

  it("activating it dispatches the same startNewConversation action desktop's sidebar uses", () => {
    const { store } = renderWithStore(<Probe pathname="/chat" />, {
      assistantConversations: {
        selectedConversationId: "existing-1",
        items: [{ id: "existing-1", title: "Existing" } as never],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    // `startNewConversation` flips `startingNewConversation` — the same
    // effect `SidebarBody`'s inline dispatch has.
    expect(store.getState().assistantConversations.startingNewConversation).toBe(true);
  });
});
