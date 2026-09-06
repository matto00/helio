// HEL-590 CR1 (evaluation-2.md CR-C) -- asserts that `buildShareUrl`'s OWN output resolves
// against the ACTUAL router, not against a hand-typed literal that merely happens to match it
// today. `mintedSharePath` below CALLS `buildShareUrl` (imported from `DashboardShareDialog.tsx`)
// and strips `window.location.origin`, so a mis-pointed `buildShareUrl` (e.g. a wrong path prefix,
// a missing `/api`, a typo) reddens THIS suite directly -- the evaluator confirmed a mutated
// `buildShareUrl` left the previous (literal-re-typing) version of this file green. Renders the
// real `App` at that resolved path and asserts the viewer renders -- NOT `NotFoundPage`. Also
// asserts all four invalid-token cases render an IDENTICAL denied state.

import { configureStore } from "@reduxjs/toolkit";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Provider } from "react-redux";

import { authReducer } from "../../auth/state/authSlice";
import { getMeRequest } from "../../auth/services/authService";
import { OverlayProvider } from "../../../shared/chrome/OverlayProvider";
import { ThemeProvider } from "../../../theme/ThemeProvider";
import { toastsReducer } from "../../toasts/state/toastsSlice";
import { App } from "../../../app/App";
import { buildShareUrl } from "./DashboardShareDialog";
import * as publicDashboardService from "../services/publicDashboardService";

jest.mock("../../auth/services/authService", () => ({
  getMeRequest: jest.fn().mockRejectedValue(new Error("unauthenticated")),
  logoutRequest: jest.fn().mockResolvedValue(undefined),
  oauthCallbackRequest: jest.fn(),
}));

jest.mock("../services/publicDashboardService", () => ({
  fetchPublicDashboardPanels: jest.fn(),
}));

const getMeRequestMock = jest.mocked(getMeRequest);
const fetchPublicDashboardPanelsMock = jest.mocked(
  publicDashboardService.fetchPublicDashboardPanels,
);

function renderAtPath(path: string) {
  const store = configureStore({ reducer: { auth: authReducer, toasts: toastsReducer } });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ThemeProvider>
        <Provider store={store}>
          <OverlayProvider>
            <App />
          </OverlayProvider>
        </Provider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

/** Calls `buildShareUrl` itself and strips `window.location.origin`, so the router-navigable path
 *  under test is DERIVED from the real function -- a mutation to `buildShareUrl`'s path shape
 *  changes what this returns, and therefore reddens the tests below. */
function mintedSharePath(dashboardId: string, token: string): string {
  const full = buildShareUrl(dashboardId, token);
  return full.slice(window.location.origin.length);
}

beforeEach(() => {
  getMeRequestMock.mockClear();
  fetchPublicDashboardPanelsMock.mockReset();
});

describe("a minted share link resolves against the real router", () => {
  it("renders the public viewer, not NotFoundPage, at the URL DashboardShareDialog composes", async () => {
    fetchPublicDashboardPanelsMock.mockResolvedValueOnce([]);

    renderAtPath(mintedSharePath("dash-1", "valid-token"));

    await waitFor(() =>
      expect(fetchPublicDashboardPanelsMock).toHaveBeenCalledWith("dash-1", "valid-token"),
    );
    expect(screen.queryByText("Page not found")).not.toBeInTheDocument();
  });

  it("renders the fetched panels", async () => {
    fetchPublicDashboardPanelsMock.mockResolvedValueOnce([
      { id: "p1", title: "Revenue", type: "text" } as never,
    ]);

    renderAtPath(mintedSharePath("dash-1", "valid-token"));

    await waitFor(() => expect(screen.getByText("Revenue")).toBeInTheDocument());
    expect(screen.queryByText("Page not found")).not.toBeInTheDocument();
  });
});

describe("invalid-token cases render an identical denied state", () => {
  it("expired, revoked, nonexistent, and wrong-resource tokens all render the same denied UI", async () => {
    fetchPublicDashboardPanelsMock.mockRejectedValue({
      response: { status: 404, data: { message: "Dashboard not found" } },
    });

    const cases = ["expired-token", "revoked-token", "nonexistent-token", "wrong-resource-token"];
    const renderedTexts: string[] = [];

    for (const token of cases) {
      const { unmount } = renderAtPath(mintedSharePath("dash-1", token));
      await waitFor(() =>
        expect(screen.getByText("This link isn't available")).toBeInTheDocument(),
      );
      renderedTexts.push(
        screen.getByText(
          "It may have been revoked, expired, or never existed. Ask the person who shared it for a new link.",
        ).textContent ?? "",
      );
      unmount();
    }

    // All four cases produced the exact same rendered copy -- never a distinct message per
    // failure mode (this is the property, not merely that each individually shows SOME denial).
    expect(new Set(renderedTexts).size).toBe(1);
  });

  it("no token at all renders the identical denied state without issuing a request", async () => {
    renderAtPath("/dashboards/dash-1/panels");

    await waitFor(() => expect(screen.getByText("This link isn't available")).toBeInTheDocument());
    expect(fetchPublicDashboardPanelsMock).not.toHaveBeenCalled();
  });
});
