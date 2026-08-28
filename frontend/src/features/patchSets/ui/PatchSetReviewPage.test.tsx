import { configureStore } from "@reduxjs/toolkit";
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { dashboardsReducer } from "../../dashboards/state/dashboardsSlice";
import { panelsReducer } from "../../panels/state/panelsSlice";
import { toastsReducer } from "../../toasts/state/toastsSlice";
import { patchSetsReducer } from "../state/patchSetsSlice";
import { fetchDashboards } from "../../dashboards/services/dashboardService";
import { fetchPanels } from "../../panels/services/panelService";
import { applyPatchSet, previewPatchSet, undoPatchSet } from "../services/patchSetService";
import { PatchSetReviewPage, baseTitle } from "./PatchSetReviewPage";
import type { Dashboard } from "../../dashboards/types/dashboard";
import type { Panel } from "../../panels/types/panel";
import type {
  PatchSet,
  PatchSetApplyResponse,
  PatchSetPreviewResponse,
  PatchSetUndoResponse,
} from "../types/patchSet";

jest.mock("../../dashboards/services/dashboardService", () => ({
  fetchDashboards: jest.fn(),
}));
jest.mock("../../panels/services/panelService", () => ({
  fetchPanels: jest.fn(),
}));
jest.mock("../services/patchSetService", () => ({
  previewPatchSet: jest.fn(),
  applyPatchSet: jest.fn(),
  undoPatchSet: jest.fn(),
}));

const mockedFetchDashboards = jest.mocked(fetchDashboards);
const mockedFetchPanels = jest.mocked(fetchPanels);
const mockedPreviewPatchSet = jest.mocked(previewPatchSet);
const mockedApplyPatchSet = jest.mocked(applyPatchSet);
const mockedUndoPatchSet = jest.mocked(undoPatchSet);

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

// HEL-413: same edits, but journaled (applicationId present) -- the case that should surface an
// "Undo" toast.
const sampleApplyResponseWithApplicationId: PatchSetApplyResponse = {
  ...sampleApplyResponse,
  applicationId: "app-1",
};

const sampleUndoResponse: PatchSetUndoResponse = {
  edits: [{ index: 0, status: "restored" }],
};

function makeStore() {
  return configureStore({
    reducer: {
      patchSets: patchSetsReducer,
      panels: panelsReducer,
      dashboards: dashboardsReducer,
      toasts: toastsReducer,
    },
  });
}

/** Renders a route probe alongside the page so a test can assert navigation happened without
 *  mocking react-router internals — mirrors ProposalReviewPage.test.tsx's own HomeProbe. */
function HomeProbe() {
  const location = useLocation();
  return <div data-testid="home-route">{location.pathname}</div>;
}

function renderPage(routeState?: { patchSet: PatchSet }) {
  const store = makeStore();
  const result = render(
    <Provider store={store}>
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
  return { ...result, store };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedFetchDashboards.mockResolvedValue([demoDashboard]);
  mockedFetchPanels.mockResolvedValue([demoPanel]);
});

describe("PatchSetReviewPage", () => {
  // F-002: the demo-fixture synthesis path (`synthesizeDemoPatchSet`) is
  // DEV-build-only now — `config/env`'s `IS_DEV` is mocked `false` under
  // Jest (`src/test/envMock.ts`), so this exercises the same "no
  // location.state" entry a production user would actually hit. Route guard
  // regression: this must never reach a live, applyable patch set (or an
  // Accept/Apply dispatch) built from the workspace's own real data with no
  // explicit hand-off.
  it("shows a 'nothing to review' empty state — never synthesizes a demo patch set — when no router state is supplied", async () => {
    renderPage();

    await screen.findByText("Nothing to review");
    expect(mockedFetchDashboards).not.toHaveBeenCalled();
    expect(mockedFetchPanels).not.toHaveBeenCalled();
    expect(mockedPreviewPatchSet).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /accept/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /back to dashboards/i }));
    await waitFor(() => {
      expect(screen.getByTestId("home-route")).toBeInTheDocument();
    });
  });

  it("renders location.state.patchSet's preview when one is supplied, skipping demo synthesis", async () => {
    mockedPreviewPatchSet.mockResolvedValueOnce(samplePreview("Renamed"));

    renderPage({ patchSet: explicitPatchSet });

    await screen.findByText("Renamed");
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

  it("Accept pushes an Undo toast with duration 0 when the apply response carries an applicationId", async () => {
    mockedPreviewPatchSet.mockResolvedValueOnce(samplePreview("Renamed"));
    mockedApplyPatchSet.mockResolvedValueOnce(sampleApplyResponseWithApplicationId);

    const { store } = renderPage({ patchSet: explicitPatchSet });

    await screen.findByRole("button", { name: /accept & apply/i });
    fireEvent.click(screen.getByRole("button", { name: /accept & apply/i }));

    await waitFor(() => {
      expect(store.getState().toasts.items).toHaveLength(1);
    });
    const toast = store.getState().toasts.items[0];
    expect(toast.message).toBe("Applied.");
    expect(toast.duration).toBe(0);
    expect(toast.action?.label).toBe("Undo");
  });

  it("Accept does NOT push an Undo toast when the apply response carries no applicationId", async () => {
    mockedPreviewPatchSet.mockResolvedValueOnce(samplePreview("Renamed"));
    mockedApplyPatchSet.mockResolvedValueOnce(sampleApplyResponse);

    const { store } = renderPage({ patchSet: explicitPatchSet });

    await screen.findByRole("button", { name: /accept & apply/i });
    fireEvent.click(screen.getByRole("button", { name: /accept & apply/i }));

    await waitFor(() => {
      expect(screen.getByTestId("home-route")).toBeInTheDocument();
    });
    expect(store.getState().toasts.items).toHaveLength(0);
  });

  it("clicking the Undo toast action calls the undo endpoint with the applicationId, dismisses the Applied toast, and shows a follow-up toast", async () => {
    mockedPreviewPatchSet.mockResolvedValueOnce(samplePreview("Renamed"));
    mockedApplyPatchSet.mockResolvedValueOnce(sampleApplyResponseWithApplicationId);
    mockedUndoPatchSet.mockResolvedValueOnce(sampleUndoResponse);

    const { store } = renderPage({ patchSet: explicitPatchSet });

    await screen.findByRole("button", { name: /accept & apply/i });
    fireEvent.click(screen.getByRole("button", { name: /accept & apply/i }));

    await waitFor(() => {
      expect(store.getState().toasts.items).toHaveLength(1);
    });
    const appliedToastId = store.getState().toasts.items[0].id;

    const undoAction = store.getState().toasts.items[0].action;
    if (!undoAction) throw new Error("expected an Undo action on the toast");
    await act(async () => {
      undoAction.onClick();
    });

    expect(mockedUndoPatchSet).toHaveBeenCalledWith("app-1");
    await waitFor(() => {
      expect(store.getState().toasts.items.some((t) => t.message === "Undone.")).toBe(true);
    });
    // skeptic-final-1.md CR2 (final-gate REFUTE) / design.md D6: the "Applied." toast is
    // dismissed by its own Undo click, not left behind as a stale, still-clickable affordance
    // alongside the new "Undone." toast.
    expect(store.getState().toasts.items.some((t) => t.id === appliedToastId)).toBe(false);
  });

  it("clicking the Undo toast action shows an error toast when the undo call is rejected (e.g. a conflict)", async () => {
    mockedPreviewPatchSet.mockResolvedValueOnce(samplePreview("Renamed"));
    mockedApplyPatchSet.mockResolvedValueOnce(sampleApplyResponseWithApplicationId);
    mockedUndoPatchSet.mockRejectedValueOnce({
      isAxiosError: true,
      response: { data: { message: "Cannot undo: the panel was changed since it was applied" } },
    });

    const { store } = renderPage({ patchSet: explicitPatchSet });

    await screen.findByRole("button", { name: /accept & apply/i });
    fireEvent.click(screen.getByRole("button", { name: /accept & apply/i }));

    await waitFor(() => {
      expect(store.getState().toasts.items).toHaveLength(1);
    });

    const undoAction = store.getState().toasts.items[0].action;
    if (!undoAction) throw new Error("expected an Undo action on the toast");
    await act(async () => {
      undoAction.onClick();
    });

    await waitFor(() => {
      expect(
        store
          .getState()
          .toasts.items.some(
            (t) => t.message === "Cannot undo: the panel was changed since it was applied",
          ),
      ).toBe(true);
    });
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
      // HEL-548 D1/D5a — PanelsState grew these two fields; this literal is
      // checked against the real (uncast) reducer type, so both are required.
      staleDashboardId: null,
      panelCreationModalOpen: false,
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
        toasts: toastsReducer,
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

  // HEL-413 evaluation-1.md CR2: the SAME live-reproduced stale-cache bug class as the Accept-side
  // regression above ("Accept refreshes the touched dashboard's cached panels"), now for Undo --
  // clicking the Undo toast action must refresh the SPA's cached panels too, not just show a
  // follow-up toast while the grid keeps showing the pre-undo (post-apply) data.
  it("Undo refreshes the touched dashboard's cached panels, when it IS the currently displayed one", async () => {
    mockedPreviewPatchSet.mockResolvedValueOnce(samplePreview("Renamed"));
    mockedApplyPatchSet.mockResolvedValueOnce(sampleApplyResponseWithApplicationId);
    mockedUndoPatchSet.mockResolvedValueOnce({
      edits: [
        {
          index: 0,
          status: "restored",
          resultingState: { id: "panel-2", dashboardId: "dash-1", title: "Original title" },
        },
      ],
    });

    const store = renderPageWithStore({
      panels: preloadedPanelsState("dash-1", [{ ...demoPanel, title: "Renamed (stale)" }]),
    });

    await screen.findByRole("button", { name: /accept & apply/i });
    fireEvent.click(screen.getByRole("button", { name: /accept & apply/i }));

    await waitFor(() => {
      expect(store.getState().toasts.items).toHaveLength(1);
    });
    // Accept's own invalidation already fired once here -- clear the spy so the assertion below
    // is attributable ONLY to Undo's invalidation, not a leftover call from Accept.
    await waitFor(() => expect(mockedFetchPanels).toHaveBeenCalledWith("dash-1"));
    mockedFetchPanels.mockClear();

    const undoAction = store.getState().toasts.items[0].action;
    if (!undoAction) throw new Error("expected an Undo action on the toast");
    await act(async () => {
      undoAction.onClick();
    });

    await waitFor(() => {
      expect(mockedFetchPanels).toHaveBeenCalledWith("dash-1");
    });
  });

  // F-002: mirrors `PanelMutationRepository`'s backend baseTitle/copyTitleRegex
  // pattern — repeated demo-fixture triggers against the same panel must stay
  // idempotent instead of stacking " (previewed) (previewed) (previewed)…".
  describe("baseTitle (F-002 idempotency)", () => {
    it("strips a single trailing '(previewed)' suffix", () => {
      expect(baseTitle("Revenue (previewed)")).toBe("Revenue");
    });

    it("strips a stacked suffix down to just the last occurrence in one pass, not the whole tail", () => {
      // A single `baseTitle` call only strips one trailing occurrence — this
      // documents that behavior on already-corrupted input rather than
      // asserting full recovery in one call.
      expect(baseTitle("Revenue (previewed) (previewed)")).toBe("Revenue (previewed)");
    });

    it("leaves an un-suffixed title unchanged", () => {
      expect(baseTitle("Revenue")).toBe("Revenue");
    });
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
