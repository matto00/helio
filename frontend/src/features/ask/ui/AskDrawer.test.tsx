// HEL-1746 D3/D6: the dashboard drawer's focus contract and size. Layout and width are NOT asserted here (jest stubs CSS):
// the 540px dialog above 768px and the full-width sheet at phone width are asserted in e2e/hel1746-ask-ui.spec.ts.
import { act, fireEvent, screen } from "@testing-library/react";
import { useState } from "react";

import { renderWithStore } from "../../../test/renderWithStore";
import { AskDrawer } from "./AskDrawer";

jest.mock("../../../services/httpClient", () => ({
  httpClient: { get: jest.fn(), post: jest.fn() },
}));

beforeEach(() => {
  jest.useFakeTimers();
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});
afterEach(() => jest.useRealTimers());

function Host({ restoreFocusSelector }: { restoreFocusSelector?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Opener
      </button>
      <button type="button" aria-label="Kebab">
        Kebab
      </button>
      <AskDrawer
        open={open}
        onClose={() => setOpen(false)}
        dashboardId="d-1"
        restoreFocusSelector={restoreFocusSelector}
      />
    </>
  );
}

const user = {
  id: "u-1",
  email: "a@example.com",
  displayName: null,
  avatarUrl: null,
  createdAt: "2026-01-01T00:00:00Z",
  tier: "beta" as const,
};

function setup(restoreFocusSelector?: string) {
  return renderWithStore(<Host restoreFocusSelector={restoreFocusSelector} />, {
    auth: { status: "authenticated", currentUser: user },
  });
}

describe("AskDrawer", () => {
  it("is a dialog titled for the dashboard, asked of the Modal at size md, with no model picker", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Opener" }));
    const dialog = document.querySelector("dialog") as HTMLDialogElement;
    expect(dialog).toHaveClass("ui-modal--md", "bottom-sheet");
    expect(dialog).not.toHaveClass("ui-modal--full");
    expect(screen.getByRole("heading", { name: "Ask about this dashboard" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("moves focus to the question field on open", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Opener" }));
    act(() => void jest.advanceTimersByTime(5));
    expect(screen.getByRole("textbox", { name: "Your question" })).toHaveFocus();
  });

  it("closing with Escape returns focus to the opener", () => {
    setup();
    const opener = screen.getByRole("button", { name: "Opener" });
    opener.focus();
    fireEvent.click(opener);
    act(() => void jest.advanceTimersByTime(5));
    const dialog = document.querySelector("dialog") as HTMLDialogElement;
    act(() => void fireEvent(dialog, new Event("cancel", { cancelable: true })));
    act(() => void jest.advanceTimersByTime(500));
    expect(opener).toHaveFocus();
  });

  it("when the opener has gone (focus on body) the drawer focuses the passed selector's match instead", () => {
    setup('button[aria-label="Kebab"]');
    fireEvent.click(screen.getByRole("button", { name: "Opener" }));
    act(() => void jest.advanceTimersByTime(5));
    // The opener unmounted while the drawer was open: Modal's restore found nothing to focus.
    (document.activeElement as HTMLElement | null)?.blur();
    const dialog = document.querySelector("dialog") as HTMLDialogElement;
    act(() => void fireEvent(dialog, new Event("cancel", { cancelable: true })));
    act(() => void jest.advanceTimersByTime(500));
    expect(screen.getByRole("button", { name: "Kebab" })).toHaveFocus();
  });
});
