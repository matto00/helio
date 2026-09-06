// HEL-590 task 6.10 — DashboardShareDialog: mint-and-copy with a mocked clipboard, the
// shown-once notice, revoke behind confirmation, the empty state, and a failed revoke surfacing
// an error. Store-connected harness mirrors ApiTokensSection.test.tsx's pattern -- the component
// dispatches its own thunks internally.

import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";

import { toastsReducer } from "../../toasts/state/toastsSlice";
import * as shareTokenService from "../services/shareTokenService";
import { shareTokensReducer } from "../state/shareTokensSlice";
import { DashboardShareDialog } from "./DashboardShareDialog";

jest.mock("../services/shareTokenService", () => ({
  listShareTokens: jest.fn(),
  createShareToken: jest.fn(),
  revokeShareToken: jest.fn(),
}));

const listShareTokensMock = jest.mocked(shareTokenService.listShareTokens);
const createShareTokenMock = jest.mocked(shareTokenService.createShareToken);
const revokeShareTokenMock = jest.mocked(shareTokenService.revokeShareToken);

const dashboardId = "dash-1";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

function buildStore() {
  return configureStore({
    reducer: { shareTokens: shareTokensReducer, toasts: toastsReducer },
    preloadedState: {
      shareTokens: { byDashboard: {} },
      toasts: { items: [] },
    },
  });
}

function renderDialog() {
  const store = buildStore();
  render(
    <Provider store={store}>
      <DashboardShareDialog
        dashboardId={dashboardId}
        dashboardName="Revenue"
        open
        onClose={() => {}}
      />
    </Provider>,
  );
  return { store };
}

beforeEach(() => {
  listShareTokensMock.mockReset();
  createShareTokenMock.mockReset();
  revokeShareTokenMock.mockReset();
});

describe("DashboardShareDialog — empty state", () => {
  it("renders an empty state, not a blank list, when there are no share links", async () => {
    listShareTokensMock.mockResolvedValueOnce([]);
    renderDialog();

    await waitFor(() => expect(screen.getByText("No share links yet")).toBeInTheDocument());
  });
});

describe("DashboardShareDialog — mint and copy", () => {
  it("shows the minted link and copies it to the clipboard on success", async () => {
    listShareTokensMock.mockResolvedValueOnce([]);
    createShareTokenMock.mockResolvedValueOnce({
      id: "tok-1",
      dashboardId,
      token: "raw-secret-token",
      expiresAt: null,
      createdAt: "2026-09-01T00:00:00Z",
    });
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderDialog();
    await waitFor(() => expect(screen.getByText("No share links yet")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Create link/ }));

    await waitFor(() =>
      expect(createShareTokenMock).toHaveBeenCalledWith(dashboardId, { expiresAt: undefined }),
    );
    expect(screen.getByLabelText("New share link")).toHaveValue(
      `${window.location.origin}/dashboards/${dashboardId}/panels?token=raw-secret-token`,
    );

    fireEvent.click(screen.getByRole("button", { name: /Copy/ }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/dashboards/${dashboardId}/panels?token=raw-secret-token`,
      ),
    );
  });

  it("shows the shown-once notice, and dismissing it (Done) removes the reveal but keeps the list entry", async () => {
    listShareTokensMock.mockResolvedValueOnce([]);
    createShareTokenMock.mockResolvedValueOnce({
      id: "tok-1",
      dashboardId,
      token: "raw-secret-token",
      expiresAt: null,
      createdAt: "2026-09-01T00:00:00Z",
    });
    renderDialog();
    await waitFor(() => expect(screen.getByText("No share links yet")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Create link/ }));
    await waitFor(() => expect(screen.getByLabelText("New share link")).toBeInTheDocument());
    expect(screen.getByText(/won.t be shown again/)).toBeInTheDocument();

    // Two "Done" buttons exist -- the reveal panel's own dismiss and the modal footer's close.
    // The reveal panel's is first in DOM order.
    fireEvent.click(screen.getAllByRole("button", { name: "Done" })[0]);

    expect(screen.queryByLabelText("New share link")).not.toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });
});

describe("DashboardShareDialog — revoke", () => {
  it("revokes only after confirmation, marking the row Revoked (not removing it, CR3)", async () => {
    listShareTokensMock.mockResolvedValueOnce([
      {
        id: "tok-1",
        dashboardId,
        expiresAt: null,
        revokedAt: null,
        createdAt: "2026-09-01T00:00:00Z",
      },
    ]);
    revokeShareTokenMock.mockResolvedValueOnce(undefined);
    renderDialog();

    await waitFor(() => expect(screen.getByText("Active")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Revoke share link" }));
    // Not yet revoked -- confirmation is pending.
    expect(revokeShareTokenMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Confirm revoke share link" }));
    await waitFor(() => expect(revokeShareTokenMock).toHaveBeenCalledWith(dashboardId, "tok-1"));
    // The row survives, now showing Revoked -- never the empty state, which would falsely imply
    // nothing was ever shared.
    await waitFor(() => expect(screen.getByText("Revoked")).toBeInTheDocument());
    expect(screen.queryByText("No share links yet")).not.toBeInTheDocument();
  });

  it("cancelling the confirmation leaves the token un-revoked", async () => {
    listShareTokensMock.mockResolvedValueOnce([
      {
        id: "tok-1",
        dashboardId,
        expiresAt: null,
        revokedAt: null,
        createdAt: "2026-09-01T00:00:00Z",
      },
    ]);
    renderDialog();
    await waitFor(() => expect(screen.getByText("Active")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Revoke share link" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(revokeShareTokenMock).not.toHaveBeenCalled();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("surfaces an inline error when revoke fails, without removing the row", async () => {
    listShareTokensMock.mockResolvedValueOnce([
      {
        id: "tok-1",
        dashboardId,
        expiresAt: null,
        revokedAt: null,
        createdAt: "2026-09-01T00:00:00Z",
      },
    ]);
    revokeShareTokenMock.mockRejectedValueOnce(new Error("network error"));
    renderDialog();
    await waitFor(() => expect(screen.getByText("Active")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Revoke share link" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm revoke share link" }));

    await waitFor(() =>
      expect(screen.getByText("Failed to revoke share link.")).toBeInTheDocument(),
    );
    expect(screen.getByText("Active")).toBeInTheDocument();
  });
});
