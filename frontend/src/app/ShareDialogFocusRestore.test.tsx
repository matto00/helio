// HEL-590 evaluation-2.md CR-E -- opening the share dialog from the desktop `ActionsMenu` and
// closing it must NOT leave focus on `document.body`. The ActionsMenu item that was clicked
// unmounts in the SAME React commit the dialog opens in, so `Modal.tsx`'s own
// "capture-activeElement-on-open" heuristic captures nothing useful for this specific invoker
// (see `shareDialogContext.tsx`'s docstring) -- `restoreFocusSelector` sidesteps that. This is the
// executor's strongest feasible jsdom-level verification of the property the evaluator's report
// asked to be checked live in a real browser at 1440/430; it exercises the identical code path
// (ActionsMenu click -> ShareDialogProvider.open -> Modal close -> restoreFocusSelector) but
// cannot substitute for that live check.

import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { assistantConversationsReducer } from "../features/assistant/state/assistantConversationsSlice";
import { authReducer } from "../features/auth/state/authSlice";
import { getMeRequest } from "../features/auth/services/authService";
import { dashboardsReducer } from "../features/dashboards/state/dashboardsSlice";
import { layoutHistoryReducer } from "../features/layout/state/layoutHistorySlice";
import { onboardingReducer } from "../features/onboarding/state/onboardingSlice";
import { panelsReducer } from "../features/panels/state/panelsSlice";
import { pipelinesReducer } from "../features/pipelines/state/pipelinesSlice";
import { getPipelines as getPipelinesRequest } from "../features/pipelines/services/pipelineService";
import { fetchSources as fetchSourcesRequest } from "../features/sources/services/dataSourceService";
import { sourcesReducer } from "../features/sources/state/sourcesSlice";
import { toastsReducer } from "../features/toasts/state/toastsSlice";
import { shareTokensReducer } from "../features/dashboards/state/shareTokensSlice";
import {
  fetchDashboards as fetchDashboardsRequest,
  updateDashboardAppearance as updateDashboardAppearanceRequest,
  updateDashboardLayout as updateDashboardLayoutRequest,
} from "../features/dashboards/services/dashboardService";
import { fetchPanels as fetchPanelsRequest } from "../features/panels/services/panelService";
import { listShareTokens } from "../features/dashboards/services/shareTokenService";
import { OverlayProvider } from "../shared/chrome/OverlayProvider";
import { ThemeProvider } from "../theme/ThemeProvider";
import { App } from "./App";

jest.mock("../features/dashboards/services/dashboardService", () => ({
  fetchDashboards: jest.fn(),
  updateDashboardAppearance: jest.fn(),
  updateDashboardLayout: jest.fn(),
}));

jest.mock("../features/panels/services/panelService", () => ({
  fetchPanels: jest.fn(),
}));

jest.mock("../features/sources/services/dataSourceService", () => ({
  fetchSources: jest.fn().mockResolvedValue([]),
}));

jest.mock("../features/pipelines/services/pipelineService", () => ({
  getPipelines: jest.fn().mockResolvedValue([]),
}));

jest.mock("../features/assistant/services/assistantConversationsService", () => ({
  listConversations: jest.fn().mockResolvedValue([]),
  getConversation: jest.fn(),
  updateConversation: jest.fn(),
}));

jest.mock("../features/dashboards/services/shareTokenService", () => ({
  listShareTokens: jest.fn(),
  createShareToken: jest.fn(),
  revokeShareToken: jest.fn(),
}));

jest.mock("../features/auth/services/authService", () => ({
  getMeRequest: jest.fn().mockResolvedValue({
    id: "test-user",
    email: "test@example.com",
    displayName: null,
    avatarUrl: null,
    createdAt: "2026-01-01T00:00:00Z",
  }),
  logoutRequest: jest.fn().mockResolvedValue(undefined),
  oauthCallbackRequest: jest.fn(),
}));

const fetchDashboardsMock = jest.mocked(fetchDashboardsRequest);
const fetchPanelsMock = jest.mocked(fetchPanelsRequest);
const getPipelinesMock = jest.mocked(getPipelinesRequest);
const fetchSourcesMock = jest.mocked(fetchSourcesRequest);
const listShareTokensMock = jest.mocked(listShareTokens);

function renderApp() {
  const store = configureStore({
    reducer: {
      assistantConversations: assistantConversationsReducer,
      auth: authReducer,
      dashboards: dashboardsReducer,
      layoutHistory: layoutHistoryReducer,
      onboarding: onboardingReducer,
      panels: panelsReducer,
      sources: sourcesReducer,
      pipelines: pipelinesReducer,
      toasts: toastsReducer,
      shareTokens: shareTokensReducer,
    },
    preloadedState: {
      auth: {
        currentUser: {
          id: "test-user",
          email: "test@example.com",
          displayName: null,
          avatarUrl: null,
          createdAt: "2026-01-01T00:00:00Z",
          tier: "owner" as const,
        },
        status: "authenticated" as const,
        submitStatus: "idle" as const,
        mfaChallenge: null,
      },
    },
  });

  return render(
    <MemoryRouter initialEntries={["/"]}>
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

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

beforeEach(() => {
  fetchDashboardsMock.mockReset();
  fetchPanelsMock.mockReset();
  getPipelinesMock.mockReset().mockResolvedValue([]);
  fetchSourcesMock.mockReset().mockResolvedValue([]);
  listShareTokensMock.mockReset();
});

describe("share dialog focus restore (desktop ActionsMenu invoker)", () => {
  it("returns focus to the dashboard's ActionsMenu trigger, not <body>, after closing", async () => {
    fetchDashboardsMock.mockResolvedValue([
      {
        id: "dash-1",
        name: "Revenue",
        meta: {
          createdBy: "system",
          createdAt: "2026-03-14T10:00:00Z",
          lastUpdated: "2026-03-14T10:00:00Z",
        },
        appearance: { background: "transparent", gridBackground: "transparent" },
        layout: { lg: [], md: [], sm: [], xs: [] },
      },
    ]);
    fetchPanelsMock.mockResolvedValue([]);
    listShareTokensMock.mockResolvedValue([]);

    renderApp();

    await waitFor(() => expect(fetchDashboardsMock).toHaveBeenCalledTimes(1));

    const trigger = await screen.findByRole("button", { name: "Revenue actions" });
    fireEvent.click(trigger);

    const shareItem = await screen.findByRole("menuitem", { name: "Share" });
    fireEvent.click(shareItem);

    await waitFor(() => expect(screen.getByText('Share "Revenue"')).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    // The restore is deferred one tick (see shareDialogContext.tsx) to avoid racing the closing
    // commit -- `waitFor` polls past it. (jsdom's native `<dialog>` mock doesn't unmount content
    // on `close()` the way a real browser's UA stylesheet does, so the assertion that matters here
    // is focus, not the dialog's continued presence in the tree.)
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(document.activeElement).not.toBe(document.body);
  });
});
