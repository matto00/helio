import { configureStore } from "@reduxjs/toolkit";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { dashboardsReducer } from "../../dashboards/state/dashboardsSlice";
import { panelsReducer } from "../../panels/state/panelsSlice";
import { patchSetsReducer } from "../state/patchSetsSlice";
import { fetchDashboards } from "../../dashboards/services/dashboardService";
import { fetchPanels } from "../../panels/services/panelService";
import { applyPatchSet, previewPatchSet } from "../services/patchSetService";
import { PatchSetReviewPage } from "./PatchSetReviewPage";
import type { Dashboard } from "../../dashboards/types/dashboard";
import type { Panel } from "../../panels/types/panel";
import type { PatchSet, PatchSetApplyResponse, PatchSetPreviewResponse } from "../types/patchSet";

jest.mock("../../dashboards/services/dashboardService", () => ({
  fetchDashboards: jest.fn(),
}));
jest.mock("../../panels/services/panelService", () => ({
  fetchPanels: jest.fn(),
}));
jest.mock("../services/patchSetService", () => ({
  previewPatchSet: jest.fn(),
  applyPatchSet: jest.fn(),
}));

const mockedFetchDashboards = jest.mocked(fetchDashboards);
const mockedFetchPanels = jest.mocked(fetchPanels);
const mockedPreviewPatchSet = jest.mocked(previewPatchSet);
const mockedApplyPatchSet = jest.mocked(applyPatchSet);

beforeAll(() => {
  // jsdom does not implement <dialog> showModal/close natively (PatchSetReview.tsx renders a
  // native <dialog>) — mirrors ProposalReviewPage.test.tsx's own stub.
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
});

const defaultMeta = {
  createdBy: "system",
  createdAt: "2026-01-01T00:00:00Z",
  lastUpdated: "2026-01-01T00:00:00Z",
};

const demoDashboard: Dashboard = {
  id: "dash-1",
  name: "Ops",
  meta: defaultMeta,
  appearance: { background: "transparent", gridBackground: "transparent" },
  layout: { lg: [], md: [], sm: [], xs: [] },
};

const demoPanel: Panel = {
  id: "panel-1",
  dashboardId: "dash-1",
  title: "Revenue",
  type: "metric",
  meta: defaultMeta,
  appearance: { background: "transparent", color: "inherit", transparency: 0 },
  config: { dataTypeId: "type-1", fieldMapping: { value: "revenue" } },
};

const explicitPatchSet: PatchSet = {
  summary: "Explicit rename",
  edits: [{ target: { kind: "panel", id: "panel-2" }, op: "update", patch: { title: "Renamed" } }],
};

function samplePreview(title: string): PatchSetPreviewResponse {
  return {
    edits: [
      {
        index: 0,
        kind: "panel",
        op: "update",
        before: { id: "panel-1", title: "Revenue" },
        after: { id: "panel-1", title },
        impact: [],
      },
    ],
  };
}

// `resultingState.dashboardId` mirrors what a real `POST /api/patch-sets/apply`
// response carries for a panel edit (the full `PanelResponse` shape) — needed
// so `patchSetsSlice`'s post-apply cache invalidation (skeptic
// evaluation-1.md CR1) has a dashboard id to invalidate/re-fetch.
const sampleApplyResponse: PatchSetApplyResponse = {
  edits: [
    {
      index: 0,
      status: "applied",
      resultingState: { id: "panel-2", dashboardId: "dash-1", title: "Renamed" },
    },
  ],
};

function makeStore() {
  return configureStore({
    reducer: { patchSets: patchSetsReducer, panels: panelsReducer, dashboards: dashboardsReducer },
  });
}

/** Renders a route probe alongside the page so a test can assert navigation happened without
 *  mocking react-router internals — mirrors ProposalReviewPage.test.tsx's own HomeProbe. */
function HomeProbe() {
  const location = useLocation();
  return <div data-testid="home-route">{location.pathname}</div>;
}

function renderPage(routeState?: { patchSet: PatchSet }) {
  return render(
    <Provider store={makeStore()}>
      <MemoryRouter
        initialEntries={[{ pathname: "/patch-sets/review", state: routeState ?? null }]}
      >
        <Routes>
          <Route path="/patch-sets/review" element={<PatchSetReviewPage />} />
          <Route path="/" element={<HomeProbe />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedFetchDashboards.mockResolvedValue([demoDashboard]);
  mockedFetchPanels.mockResolvedValue([demoPanel]);
});

describe("PatchSetReviewPage", () => {
  it("renders the synthesized demo patch set's preview when no router state is supplied", async () => {
    mockedPreviewPatchSet.mockResolvedValueOnce(samplePreview("Revenue (previewed)"));

    renderPage();

    await waitFor(() => {
      expect(mockedFetchDashboards).toHaveBeenCalledTimes(1);
      expect(mockedFetchPanels).toHaveBeenCalledWith("dash-1");
    });
    await screen.findByText(/Revenue \(previewed\)/);
    expect(mockedPreviewPatchSet).toHaveBeenCalledWith(
      expect.objectContaining({
        edits: [
          expect.objectContaining({
            target: { kind: "panel", id: "panel-1" },
            op: "update",
          }),
        ],
      }),
    );
  });

  it("renders location.state.patchSet's preview when one is supplied, skipping demo synthesis", async () => {
    mockedPreviewPatchSet.mockResolvedValueOnce(samplePreview("Renamed"));

    renderPage({ patchSet: explicitPatchSet });

    await screen.findByText(/"Renamed"/);
    expect(mockedFetchDashboards).not.toHaveBeenCalled();
    expect(mockedPreviewPatchSet).toHaveBeenCalledWith(explicitPatchSet);
  });

  it("Accept dispatches applyPatchSet and navigates to /", async () => {
    mockedPreviewPatchSet.mockResolvedValueOnce(samplePreview("Renamed"));
    mockedApplyPatchSet.mockResolvedValueOnce(sampleApplyResponse);

    renderPage({ patchSet: explicitPatchSet });

    await screen.findByRole("button", { name: /accept & apply/i });
    fireEvent.click(screen.getByRole("button", { name: /accept & apply/i }));

    await waitFor(() => {
      expect(screen.getByTestId("home-route")).toBeInTheDocument();
    });
    expect(mockedApplyPatchSet).toHaveBeenCalledWith(explicitPatchSet);
  });

  // A currently-loaded panels slice, seeded via `preloadedState` — mirrors
  // what `App.tsx`'s own `fetchPanels` effect would have already populated
  // before the user ever navigated to `/patch-sets/review`.
  function preloadedPanelsState(loadedDashboardId: string | null, items: Panel[]) {
    return {
      items,
      loadedDashboardId,
      status: "succeeded" as const,
      error: null,
      pendingPanelUpdates: {},
      lastSavedAt: null,
      paginationState: {},
    };
  }

  function renderPageWithStore(preloadedState: {
    panels: ReturnType<typeof preloadedPanelsState>;
  }) {
    const store = configureStore({
      reducer: {
        patchSets: patchSetsReducer,
        panels: panelsReducer,
        dashboards: dashboardsReducer,
      },
      preloadedState,
    });
    render(
      <Provider store={store}>
        <MemoryRouter
          initialEntries={[
            { pathname: "/patch-sets/review", state: { patchSet: explicitPatchSet } },
          ]}
        >
          <Routes>
            <Route path="/patch-sets/review" element={<PatchSetReviewPage />} />
            <Route path="/" element={<HomeProbe />} />
          </Routes>
        </MemoryRouter>
      </Provider>,
    );
    return store;
  }

  // skeptic evaluation-1.md CR1 (Phase 3 UI review FAIL): Accept succeeding
  // must genuinely refresh the SPA's cached panel state for the touched
  // dashboard, not just navigate home while the old data stays cached.
  it("Accept refreshes the touched dashboard's cached panels, when it IS the currently displayed one", async () => {
    mockedPreviewPatchSet.mockResolvedValueOnce(samplePreview("Renamed"));
    mockedApplyPatchSet.mockResolvedValueOnce(sampleApplyResponse);

    // "dash-1" (the edit's touched dashboard, per `sampleApplyResponse`) is
    // ALSO the currently-loaded one — the case the fix must still handle.
    const store = renderPageWithStore({
      panels: preloadedPanelsState("dash-1", [{ ...demoPanel, title: "Revenue (stale)" }]),
    });

    // `explicitPatchSet`'s router-state entry point never calls `fetchDashboards`/
    // `fetchPanels` up front (no demo synthesis) — any call to the panel-list
    // service below is therefore attributable ONLY to Accept's invalidation.
    expect(mockedFetchPanels).not.toHaveBeenCalled();

    await screen.findByRole("button", { name: /accept & apply/i });
    fireEvent.click(screen.getByRole("button", { name: /accept & apply/i }));

    await waitFor(() => {
      expect(mockedFetchPanels).toHaveBeenCalledWith("dash-1");
    });
    // The panels slice genuinely re-fetched (not merely marked stale and left
    // hanging) — `loadedDashboardId` is set back once the re-fetch resolves.
    await waitFor(() => {
      expect(store.getState().panels.loadedDashboardId).toBe("dash-1");
      expect(store.getState().panels.items).toEqual([demoPanel]);
    });
  });

  // skeptic-final-1.md CR1 (final-gate REFUTE): the live-reproduced defect —
  // an unconditional refetch silently overwrote the panel grid with a
  // DIFFERENT, not-currently-displayed dashboard's panels. Here the user is
  // actively viewing "dash-OTHER" (its own real panel cached) while the
  // patch set touches "dash-1" — the currently-displayed dashboard's cache
  // MUST be left completely untouched.
  it("does NOT touch the currently-displayed dashboard's panels when the patch set touches a DIFFERENT dashboard", async () => {
    mockedPreviewPatchSet.mockResolvedValueOnce(samplePreview("Renamed"));
    mockedApplyPatchSet.mockResolvedValueOnce(sampleApplyResponse);

    const otherDashboardPanel: Panel = {
      ...demoPanel,
      id: "panel-other",
      dashboardId: "dash-OTHER",
      title: "Isolation Pie",
    };
    const store = renderPageWithStore({
      panels: preloadedPanelsState("dash-OTHER", [otherDashboardPanel]),
    });

    await screen.findByRole("button", { name: /accept & apply/i });
    fireEvent.click(screen.getByRole("button", { name: /accept & apply/i }));

    await waitFor(() => {
      expect(screen.getByTestId("home-route")).toBeInTheDocument();
    });

    // The touched dashboard ("dash-1") is NOT the one on screen
    // ("dash-OTHER") — no refetch should ever have fired, and the displayed
    // dashboard's own panel must be exactly what it was before Accept.
    expect(mockedFetchPanels).not.toHaveBeenCalled();
    expect(store.getState().panels.loadedDashboardId).toBe("dash-OTHER");
    expect(store.getState().panels.items).toEqual([otherDashboardPanel]);
  });

  it("Reject navigates to / without applying", async () => {
    mockedPreviewPatchSet.mockResolvedValueOnce(samplePreview("Renamed"));

    renderPage({ patchSet: explicitPatchSet });

    await screen.findByRole("button", { name: /reject/i });
    fireEvent.click(screen.getByRole("button", { name: /reject/i }));

    await waitFor(() => {
      expect(screen.getByTestId("home-route")).toBeInTheDocument();
    });
    expect(mockedApplyPatchSet).not.toHaveBeenCalled();
  });
});
