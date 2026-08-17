// HEL-704 tasks.md 7.5 — tier-aware rendering (settings-beta-access-ui spec: `free` sees request
// + redeem controls, `beta`/`owner` see confirmation only) plus the two inline-outcome flows:
// request-access success/error, and redeem success (unlocks via `setAuth`, verified through the
// store's `auth.currentUser`) / failure (state unchanged).

import { fireEvent, screen, waitFor } from "@testing-library/react";

import * as settingsService from "../services/settingsService";
import { renderWithStore } from "../../../test/renderWithStore";
import type { User } from "../../auth/types/user";
import { BetaAccessSection } from "./BetaAccessSection";

jest.mock("../services/settingsService", () => ({
  requestBetaAccess: jest.fn(),
  redeemInviteCode: jest.fn(),
}));

const requestBetaAccessMock = jest.mocked(settingsService.requestBetaAccess);
const redeemInviteCodeMock = jest.mocked(settingsService.redeemInviteCode);

function userWithTier(tier: User["tier"]): User {
  return {
    id: "user-1",
    email: "user@example.com",
    displayName: null,
    avatarUrl: null,
    createdAt: "2026-08-01T00:00:00Z",
    tier,
  };
}

beforeEach(() => {
  requestBetaAccessMock.mockReset();
  redeemInviteCodeMock.mockReset();
});

describe("BetaAccessSection — tier-aware rendering", () => {
  it("shows a request action and a code-entry field for a free-tier user", () => {
    renderWithStore(<BetaAccessSection />, {
      auth: { status: "authenticated", currentUser: userWithTier("free") },
    });

    expect(screen.getByRole("button", { name: "Request Beta access" })).toBeInTheDocument();
    expect(screen.getByLabelText("Invite code")).toBeInTheDocument();
  });

  it("shows a confirmation and no controls for a beta-tier user", () => {
    renderWithStore(<BetaAccessSection />, {
      auth: { status: "authenticated", currentUser: userWithTier("beta") },
    });

    expect(screen.getByText("You have Beta access.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request Beta access" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Invite code")).not.toBeInTheDocument();
  });

  it("shows a confirmation and no controls for an owner-tier user", () => {
    renderWithStore(<BetaAccessSection />, {
      auth: { status: "authenticated", currentUser: userWithTier("owner") },
    });

    expect(screen.getByText("You have workspace-owner access.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request Beta access" })).not.toBeInTheDocument();
  });

  it("renders nothing when no user is resolved yet", () => {
    const { container } = renderWithStore(<BetaAccessSection />, {
      auth: { status: "loading", currentUser: null },
    });
    expect(container).toBeEmptyDOMElement();
  });
});

describe("BetaAccessSection — request action", () => {
  it("shows an inline confirmation when the request succeeds", async () => {
    requestBetaAccessMock.mockResolvedValueOnce(undefined);
    renderWithStore(<BetaAccessSection />, {
      auth: { status: "authenticated", currentUser: userWithTier("free") },
    });

    fireEvent.click(screen.getByRole("button", { name: "Request Beta access" }));

    await waitFor(() =>
      expect(screen.getByText("Request sent — the owner has been notified.")).toBeInTheDocument(),
    );
    expect(requestBetaAccessMock).toHaveBeenCalledTimes(1);
  });

  it("shows the endpoint's error inline when the request fails", async () => {
    requestBetaAccessMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { data: { message: "Beta access requests are not available right now." } },
    });
    renderWithStore(<BetaAccessSection />, {
      auth: { status: "authenticated", currentUser: userWithTier("free") },
    });

    fireEvent.click(screen.getByRole("button", { name: "Request Beta access" }));

    await waitFor(() =>
      expect(
        screen.getByText("Beta access requests are not available right now."),
      ).toBeInTheDocument(),
    );
  });
});

describe("BetaAccessSection — redeem action", () => {
  it("unlocks immediately (auth.currentUser.tier becomes beta) on a valid code — the section itself switches to the beta confirmation view, since it is tier-derived", async () => {
    const upgradedUser = userWithTier("beta");
    redeemInviteCodeMock.mockResolvedValueOnce(upgradedUser);
    const { store } = renderWithStore(<BetaAccessSection />, {
      auth: { status: "authenticated", currentUser: userWithTier("free") },
    });

    fireEvent.change(screen.getByLabelText("Invite code"), { target: { value: "VALIDCODE" } });
    fireEvent.click(screen.getByRole("button", { name: "Redeem code" }));

    await waitFor(() => expect(redeemInviteCodeMock).toHaveBeenCalledWith("VALIDCODE"));
    await waitFor(() => {
      const state = store.getState() as { auth: { currentUser: User | null } };
      expect(state.auth.currentUser?.tier).toBe("beta");
    });
    // No re-login/reload required -- the same mounted component re-renders as the beta
    // confirmation view purely from the updated `auth` slice, and the redeem form (code field
    // included) is gone since it's no longer eligible.
    await waitFor(() => expect(screen.getByText("You have Beta access.")).toBeInTheDocument());
    expect(screen.queryByLabelText("Invite code")).not.toBeInTheDocument();
  });

  it("shows a clear inline error and leaves the current user's tier unchanged for an invalid code", async () => {
    redeemInviteCodeMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { data: { message: "Invalid or already-used invite code" } },
    });
    const { store } = renderWithStore(<BetaAccessSection />, {
      auth: { status: "authenticated", currentUser: userWithTier("free") },
    });

    fireEvent.change(screen.getByLabelText("Invite code"), { target: { value: "BADCODE" } });
    fireEvent.click(screen.getByRole("button", { name: "Redeem code" }));

    await waitFor(() =>
      expect(screen.getByText("Invalid or already-used invite code")).toBeInTheDocument(),
    );
    const state = store.getState() as { auth: { currentUser: User | null } };
    expect(state.auth.currentUser?.tier).toBe("free");
    // The submitted code is preserved so the user can see what was rejected.
    expect(screen.getByLabelText("Invite code")).toHaveValue("BADCODE");
  });
});
