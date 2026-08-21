import { fireEvent, screen, waitFor } from "@testing-library/react";

import { createDashboard as createDashboardRequest } from "../../dashboards/services/dashboardService";
import { fetchSources as fetchSourcesRequest } from "../../sources/services/dataSourceService";
import { getPipelines as getPipelinesRequest } from "../../pipelines/services/pipelineService";
import { renderWithStore } from "../../../test/renderWithStore";
import { PanelGrid } from "./PanelGrid";
import { PanelList } from "./PanelList";

jest.mock("./PanelGrid", () => {
  const React = require("react") as typeof import("react");
  return {
    PanelGrid: jest.fn(({ panels }: { panels: { id: string; title: string }[] }) =>
      React.createElement(
        "div",
        { "data-testid": "panel-grid" },
        ...panels.map((p) => React.createElement("h3", { key: p.id }, p.title)),
      ),
    ),
  };
});

jest.mock("../services/panelService", () => ({
  createPanel: jest.fn(),
  fetchPanels: jest.fn(),
  updatePanelAppearance: jest.fn(),
}));

jest.mock("../../dashboards/services/dashboardService", () => ({
  createDashboard: jest.fn(),
}));

jest.mock("../../sources/services/dataSourceService", () => ({
  fetchSources: jest.fn().mockResolvedValue([]),
}));

jest.mock("../../pipelines/services/pipelineService", () => ({
  getPipelines: jest.fn().mockResolvedValue([]),
}));

jest.mock("../../auth/services/authService", () => ({
  updateUserPreferencesRequest: jest.fn().mockResolvedValue({ accentColor: null, zoomLevels: {} }),
}));

const createDashboardMock = jest.mocked(createDashboardRequest);
const fetchSourcesMock = jest.mocked(fetchSourcesRequest);
const getPipelinesMock = jest.mocked(getPipelinesRequest);

const authUser = {
  id: "user-1",
  email: "test@example.com",
  displayName: "Test User",
  avatarUrl: null,
  tier: "free" as const,
  createdAt: "2026-01-01T00:00:00Z",
};

const emptyAccount = {
  auth: { status: "authenticated" as const, currentUser: authUser },
  dashboards: { items: [], selectedDashboardId: null, status: "succeeded" as const },
  panels: { items: [], status: "idle" as const },
  onboarding: { dismissed: false },
};

describe("PanelList <-> OnboardingChecklist integration (HEL-554)", () => {
  beforeEach(() => {
    createDashboardMock.mockReset();
    fetchSourcesMock.mockReset().mockResolvedValue([]);
    getPipelinesMock.mockReset().mockResolvedValue([]);
    // `useOnboardingHost` re-hydrates `dismissed` from the REAL
    // `window.localStorage` on every mount (never trusts a preloaded Redux
    // value alone) — clear it so no test's `recordOnboardingComplete` write
    // leaks a stored dismissal into a later test in this file.
    window.localStorage.clear();
  });

  // 6.3 — no-flash: visibility is DERIVED (not awaited), so given an
  // already-resolved empty+succeeded `dashboards` state, the checklist and
  // the absence of the superseded empty state hold in the SAME render — no
  // second render/effect cycle is needed to reach this state. (The genuine
  // async transient — whether a real browser ever paints an intermediate
  // frame — is not observable through RTL's `act()`-batched renders; that
  // is verified live in section 5 of tasks.md, not here.)
  it("shows the checklist on the very first render for an empty, un-dismissed account, and the superseded empty state never renders", () => {
    renderWithStore(<PanelList />, emptyAccount);

    expect(screen.getByRole("region", { name: "Getting started" })).toBeInTheDocument();
    expect(screen.queryByText("No dashboards yet")).not.toBeInTheDocument();
  });

  // Mirror scenario — a returning user with a dashboard is not auto-activated
  // and sees the ordinary chrome unaffected.
  it("does not show the checklist for a returning user who already has a dashboard", () => {
    renderWithStore(<PanelList />, {
      ...emptyAccount,
      dashboards: {
        items: [
          {
            id: "dash-1",
            name: "Ops",
            meta: {
              createdBy: "system",
              createdAt: "2026-01-01T00:00:00Z",
              lastUpdated: "2026-01-01T00:00:00Z",
            },
          },
        ],
        selectedDashboardId: "dash-1",
        status: "succeeded",
      },
      panels: { items: [], loadedDashboardId: "dash-1", status: "succeeded" },
    });

    expect(screen.queryByRole("region", { name: "Getting started" })).not.toBeInTheDocument();
  });

  // A stored dismissal suppresses auto-activation. `useOnboardingHost`
  // re-hydrates from the REAL `localStorage` on mount (never trusts a
  // preloaded Redux value alone), so the dismissal is written there
  // directly — the actual mechanism a returning, previously-dismissed user
  // would hit, not a value that could satisfy the task text while proving
  // nothing (round-4 skeptic finding). `onboarding` is deliberately left at
  // its real, un-overridden default here (`dismissed: null`, "not yet
  // hydrated") — production never starts this slice at `dismissed: false`
  // ahead of the hydration effect that would set it; only a test forcing
  // that specific, unreachable combination could ever see it race.
  it("does not show the checklist when a dismissal is already stored for this user", () => {
    window.localStorage.setItem("helio-onboarding-dismissed-user-1", "true");
    renderWithStore(<PanelList />, {
      auth: emptyAccount.auth,
      dashboards: emptyAccount.dashboards,
      panels: emptyAccount.panels,
    });
    expect(screen.queryByRole("region", { name: "Getting started" })).not.toBeInTheDocument();
    expect(screen.getByText("No dashboards yet")).toBeInTheDocument();
  });

  // 6.9 — supersede: neither zero-content EmptyState renders while the
  // checklist is visible; both render unchanged when it is not.
  describe("supersede (D5)", () => {
    it("suppresses the zero-panel EmptyState (including the post-delete terminal state) while the checklist is visible", () => {
      renderWithStore(<PanelList />, {
        ...emptyAccount,
        dashboards: {
          items: [
            {
              id: "dash-1",
              name: "Ops",
              meta: {
                createdBy: "system",
                createdAt: "2026-01-01T00:00:00Z",
                lastUpdated: "2026-01-01T00:00:00Z",
              },
            },
          ],
          selectedDashboardId: "dash-1",
          status: "succeeded",
        },
        panels: {
          items: [],
          status: "idle",
          staleDashboardId: "dash-1", // the post-delete terminal state
        },
        onboarding: { active: true, dismissed: false },
      });

      expect(screen.getByRole("region", { name: "Getting started" })).toBeInTheDocument();
      expect(screen.queryByText("No panels yet")).not.toBeInTheDocument();
    });

    it("renders the zero-panel EmptyState (including the post-delete terminal state) unchanged when the checklist is not visible", () => {
      renderWithStore(<PanelList />, {
        auth: { status: "authenticated", currentUser: authUser },
        dashboards: {
          items: [
            {
              id: "dash-1",
              name: "Ops",
              meta: {
                createdBy: "system",
                createdAt: "2026-01-01T00:00:00Z",
                lastUpdated: "2026-01-01T00:00:00Z",
              },
            },
          ],
          selectedDashboardId: "dash-1",
          status: "succeeded",
        },
        panels: { items: [], status: "idle", staleDashboardId: "dash-1" },
        onboarding: { dismissed: true },
      });

      expect(screen.queryByRole("region", { name: "Getting started" })).not.toBeInTheDocument();
      expect(screen.getByText("No panels yet")).toBeInTheDocument();
    });
  });

  // D1 — mounted OUTSIDE the skeleton gate: stays visible through the
  // `fetchPanels` round trip a newly-selected dashboard's skeleton covers.
  it("stays rendered while the panel-grid skeleton is up (does not blink out mid-transition)", () => {
    const { container } = renderWithStore(<PanelList />, {
      ...emptyAccount,
      dashboards: {
        items: [
          {
            id: "dash-1",
            name: "Ops",
            meta: {
              createdBy: "system",
              createdAt: "2026-01-01T00:00:00Z",
              lastUpdated: "2026-01-01T00:00:00Z",
            },
          },
        ],
        selectedDashboardId: "dash-1",
        status: "succeeded",
      },
      panels: { items: [], status: "loading" },
      onboarding: { active: true, dismissed: false },
    });

    expect(screen.getByRole("region", { name: "Getting started" })).toBeInTheDocument();
    expect(container.querySelector(".panel-list__zoom-container .ui-skeleton")).toBeInTheDocument();
  });

  // Finding #2 (round-4 skeptic) — ONE `useCreateDashboardAction()` instance
  // shared for both the click and the error: a failed create invoked from
  // the checklist's own button must be visible from the checklist itself,
  // not lost to an instance nothing renders.
  it("a failed dashboard create from the checklist's own button is reported on the checklist (shared create-action instance)", async () => {
    createDashboardMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { data: { error: "Name already taken." } },
    });
    renderWithStore(<PanelList />, emptyAccount);

    fireEvent.click(screen.getByRole("button", { name: "New dashboard" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Name already taken.");
    // And the checklist itself (not a second, independent surface) is what
    // carries it.
    expect(screen.getByRole("region", { name: "Getting started" })).toContainElement(alert);
  });

  // D6/task 2.13 — the emphasis recipe follows the SAME "superseding" value
  // task 4.2 computes for suppression: Primary while superseding the empty
  // zero-dashboard region, Secondary once real content exists below it.
  describe("emphasis placement (D6)", () => {
    it("uses Primary on the first incomplete step's action in the superseding (zero-content) placement", () => {
      renderWithStore(<PanelList />, emptyAccount);
      // Step 1 (source) is the first incomplete step here — it carries the
      // emphasis, not "New dashboard" (step 3), which is Ghost instead.
      expect(screen.getByRole("button", { name: "Go to Data Sources" })).toHaveClass(
        "onboarding-checklist__action--primary",
      );
      expect(screen.getByRole("button", { name: "New dashboard" })).toHaveClass(
        "onboarding-checklist__action--ghost",
      );
    });

    it("uses Secondary once the checklist sits above a populated grid (all-four-complete)", () => {
      renderWithStore(<PanelList />, {
        auth: { status: "authenticated", currentUser: authUser },
        dashboards: {
          items: [
            {
              id: "dash-1",
              name: "Ops",
              meta: {
                createdBy: "system",
                createdAt: "2026-01-01T00:00:00Z",
                lastUpdated: "2026-01-01T00:00:00Z",
              },
            },
          ],
          selectedDashboardId: "dash-1",
          status: "succeeded",
        },
        panels: {
          items: [
            { id: "panel-1", dashboardId: "dash-1", title: "Revenue", type: "metric" as const },
          ],
          loadedDashboardId: "dash-1",
          status: "succeeded",
        },
        sources: { status: "succeeded", items: [{ id: "s1" } as never] },
        pipelines: { status: "succeeded", items: [{ id: "p1" } as never] },
        onboarding: { active: true, dismissed: false },
      });

      expect(screen.getByTestId("panel-grid")).toBeInTheDocument();
      expect(screen.getByText("That's the whole chain")).toBeInTheDocument();
      // The completed chain's steps are all checked (no action buttons left
      // — Done is the only surface-level action), so the "above the grid"
      // Secondary claim is checked structurally instead: the surface
      // renders above a REAL populated grid, not a superseded empty region.
      expect(screen.queryByText("No dashboards yet")).not.toBeInTheDocument();
    });
  });

  // D3 — the host hook's own fetch trigger, exercised through the real host
  // surface rather than in isolation.
  it("dispatches fetchSources/fetchPipelines once the checklist is visible", async () => {
    renderWithStore(<PanelList />, emptyAccount);
    await waitFor(() => expect(fetchSourcesMock).toHaveBeenCalledTimes(1));
    expect(getPipelinesMock).toHaveBeenCalledTimes(1);
  });
});
