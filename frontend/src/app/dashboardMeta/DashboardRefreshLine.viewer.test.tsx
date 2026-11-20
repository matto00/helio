// HEL-1782 D1: the phone meta line says "View only" for a viewer from the first paint, from the CURRENT role (not one
// latched at first paint), and never for an editor or the owner.
import { act, screen } from "@testing-library/react";

import { useSharedDashboardMeta } from "../../features/panels/hooks/usePanelStatus";
import type { DashboardMeta } from "../../features/panels/state/dashboardMeta";
import { fetchDashboards } from "../../features/dashboards/state/dashboardsSlice";
import { resetUseNowForTests } from "../../hooks/useNow";
import { renderWithStore } from "../../test/renderWithStore";
import { DashboardRefreshLine } from "./DashboardRefreshLine";

jest.mock("../../features/panels/hooks/useDashboardMeta", () => ({
  useDashboardMeta: jest.fn(() => ({
    panelCount: 0,
    refreshState: "unknown",
    refreshedAt: null,
    refreshIntent: null,
    sources: [],
    moreSources: 0,
  })),
}));
jest.mock("../../features/panels/hooks/usePanelStatus", () => ({
  ...jest.requireActual("../../features/panels/hooks/usePanelStatus"),
  useSharedDashboardMeta: jest.fn(),
}));
const sharedMeta = jest.mocked(useSharedDashboardMeta);
const unknownMeta: DashboardMeta = {
  panelCount: 0,
  refreshState: "unknown",
  refreshedAt: null,
  refreshIntent: null,
  sources: [],
  moreSources: 0,
};

function render(accessRole: "owner" | "editor" | "viewer") {
  return renderWithStore(
    <DashboardRefreshLine />,
    {
      auth: { status: "authenticated", currentUser: { id: "me" } as never },
      dashboards: {
        items: [
          { id: "d1", name: "Ops", accessRole, ownerId: accessRole === "owner" ? "me" : "other" },
        ],
        selectedDashboardId: "d1",
        status: "succeeded",
      },
    },
    "/dashboards",
  );
}

beforeEach(() => {
  resetUseNowForTests();
  sharedMeta.mockReturnValue(unknownMeta);
});

describe("DashboardRefreshLine by role (HEL-1782)", () => {
  it("shows a viewer 'View only' as visible, exposed text even with no refresh fact and no pipeline-fed panel", () => {
    const { container } = render("viewer");
    const text = screen.getByText("View only");
    expect(text).toBeInTheDocument();
    expect(text.closest('[aria-hidden="true"]')).toBeNull();
    expect(container.querySelector(".dashboard-refresh-line")).not.toBeNull();
  });

  it("puts the refresh fact after it, separated by a dot", () => {
    sharedMeta.mockReturnValue({
      ...unknownMeta,
      refreshState: "ran",
      refreshedAt: new Date(Date.now() - 9 * 3600_000).toISOString(),
    });
    const { container } = render("viewer");
    const line = container.querySelector(".dashboard-refresh-line__text");
    expect(line?.textContent).toMatch(/^View only · refreshed /);
  });

  it("follows the CURRENT role: an editor downgraded to viewer gains the indicator", () => {
    const { store, container } = render("editor");
    expect(screen.queryByText("View only")).toBeNull();
    act(() => {
      store.dispatch(
        fetchDashboards.fulfilled(
          [
            {
              id: "d1",
              name: "Ops",
              accessRole: "viewer",
              ownerId: "other",
              meta: { createdBy: "u", createdAt: "x", lastUpdated: "x" },
              appearance: { background: "transparent", gridBackground: "transparent" },
              layout: { lg: [], md: [], sm: [], xs: [] },
            } as never,
          ],
          "r",
          undefined,
        ),
      );
    });
    expect(screen.getByText("View only")).toBeInTheDocument();
    expect(container.querySelector(".dashboard-refresh-line")).not.toBeNull();
  });

  it.each(["owner", "editor"] as const)("shows the %s no View only", (role) => {
    render(role);
    expect(screen.queryByText("View only")).toBeNull();
  });
});
