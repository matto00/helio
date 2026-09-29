// HEL-1190 design.md D1/D9 (tasks 3.2/3.3) — red-first against today's title/kind-only rendering:
// before this ticket, `PublicDashboardViewerPage` never called `fetchPublicPanelRows`/
// `fetchPublicOutputMeta` at all, so an output-kind panel's actual row data never reached the DOM
// (only its title and the literal string "output"). These tests fail against that prior behavior
// and pass against the real content this ticket adds.

import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Provider } from "react-redux";

import { PublicDashboardViewerPage } from "./PublicDashboardViewerPage";
import { authReducer } from "../../auth/state/authSlice";
import { panelsReducer } from "../../panels/state/panelsSlice";
import { updateOutput } from "../../pipelines/services/outputService";
import * as publicDashboardService from "../services/publicDashboardService";
import type { OutputPanel } from "../../panels/types/panel";

jest.mock("../services/publicDashboardService", () => ({
  fetchPublicDashboardPanels: jest.fn(),
  fetchPublicPanelRows: jest.fn(),
  fetchPublicOutputMeta: jest.fn(),
  fetchPublicDistinctValues: jest.fn(),
}));

jest.mock("../../pipelines/services/outputService", () => ({
  ...jest.requireActual("../../pipelines/services/outputService"),
  updateOutput: jest.fn().mockResolvedValue({}),
}));

const fetchPublicDashboardPanelsMock = jest.mocked(
  publicDashboardService.fetchPublicDashboardPanels,
);
const fetchPublicPanelRowsMock = jest.mocked(publicDashboardService.fetchPublicPanelRows);
const fetchPublicOutputMetaMock = jest.mocked(publicDashboardService.fetchPublicOutputMeta);
const fetchPublicDistinctValuesMock = jest.mocked(publicDashboardService.fetchPublicDistinctValues);
const updateOutputMock = jest.mocked(updateOutput);

const tablePanel: OutputPanel = {
  id: "panel-1",
  dashboardId: "dash-1",
  title: "Sales by region",
  meta: { lastUpdated: "2026-01-01T00:00:00Z" } as never,
  appearance: { background: "transparent", color: "inherit", transparency: 0 } as never,
  type: "output",
  config: { outputId: "out-1", controls: [] },
};

function renderAt(path: string, authenticatedUserId?: string) {
  const store = configureStore({
    reducer: { auth: authReducer, panels: panelsReducer },
    preloadedState: authenticatedUserId
      ? {
          auth: {
            currentUser: {
              id: authenticatedUserId,
              email: "owner@helio.test",
              displayName: null,
              avatarUrl: null,
              createdAt: "2026-01-01T00:00:00Z",
              tier: "free",
            },
            status: "authenticated",
            submitStatus: "idle",
            mfaChallenge: null,
          } as never,
        }
      : undefined,
  });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Provider store={store}>
        <Routes>
          <Route path="/dashboards/:dashboardId/panels" element={<PublicDashboardViewerPage />} />
        </Routes>
      </Provider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  fetchPublicDashboardPanelsMock.mockReset();
  fetchPublicPanelRowsMock.mockReset();
  fetchPublicOutputMetaMock.mockReset();
  fetchPublicDistinctValuesMock.mockReset();
  updateOutputMock.mockClear();
});

describe("PublicDashboardViewerPage renders real output-panel content (HEL-1190 D1)", () => {
  it("shows a table-kind panel's actual rows, not just its title/kind", async () => {
    fetchPublicDashboardPanelsMock.mockResolvedValueOnce([tablePanel]);
    fetchPublicOutputMetaMock.mockResolvedValueOnce({
      kind: "table",
      config: {},
      schema: [{ name: "region", type: "string" }],
      ownerId: null,
    });
    fetchPublicPanelRowsMock.mockResolvedValueOnce({
      items: [{ region: "east" }, { region: "west" }],
      total: 2,
      offset: 0,
      limit: 200,
    });

    renderAt("/dashboards/dash-1/panels?token=valid-token");

    await waitFor(() => expect(screen.getByText("east")).toBeInTheDocument());
    expect(screen.getByText("west")).toBeInTheDocument();
    // Pre-fix rendering ("output" as a bare kind badge, no row data) is gone.
    expect(screen.queryByText("output")).not.toBeInTheDocument();
  });

  // HEL-1190 design.md D9 (task 3.3) — red-first, simulating an OWNER's authenticated session:
  // before D9's fix, `output.ownerId` would have been forwarded from the wire response, letting
  // `TableRenderer`'s `canWrite` become true for the matching session and issue a real PATCH on a
  // sort click. `usePublicPanelData` always reconstructs `ownerId: null`, so `canWrite` is
  // structurally false regardless of the authenticated user id matching the real owner.
  it("issues no PATCH when an authenticated OWNER session clicks a column sort on the public view", async () => {
    fetchPublicDashboardPanelsMock.mockResolvedValueOnce([tablePanel]);
    fetchPublicOutputMetaMock.mockResolvedValueOnce({
      kind: "table",
      config: {},
      schema: [{ name: "region", type: "string" }],
      ownerId: null,
    });
    fetchPublicPanelRowsMock.mockResolvedValueOnce({
      items: [{ region: "east" }, { region: "west" }],
      total: 2,
      offset: 0,
      limit: 200,
    });

    // The viewing session belongs to the SAME user id as the real Output owner would be —
    // proving the read-only guarantee holds independent of session identity, per spec.md.
    renderAt("/dashboards/dash-1/panels?token=valid-token", "owner-user-id");

    await waitFor(() => expect(screen.getByText("east")).toBeInTheDocument());
    const sortButton = screen.getByRole("button", { name: "region" });
    fireEvent.click(sortButton);

    expect(updateOutputMock).not.toHaveBeenCalled();
  });
});

// HEL-1190 design.md D1-D4 (tasks 4.1-4.5, 5.4) — the viewer control bar wired into the public
// render path, composing into `fetchPublicPanelRows`'s own `filter` param via the SAME
// `buildViewerControlFilterOps`/`composeOutputRowsFilter` machinery every authenticated path uses.
describe("PublicDashboardViewerPage — viewer controls (HEL-1190 D1-D4, task 5.4)", () => {
  const panelWithControl: OutputPanel = {
    ...tablePanel,
    config: {
      outputId: "out-1",
      controls: [{ id: "c1", kind: "dropdown", column: "region", label: "Region" }],
    },
  };

  it("renders the control bar and composes a selection into the public rows request", async () => {
    fetchPublicDashboardPanelsMock.mockResolvedValueOnce([panelWithControl]);
    fetchPublicOutputMetaMock.mockResolvedValue({
      kind: "table",
      config: {},
      schema: [{ name: "region", type: "string" }],
      ownerId: null,
    });
    fetchPublicDistinctValuesMock.mockResolvedValue({
      column: "region",
      values: [{ value: "east", count: 3 }],
    });
    fetchPublicPanelRowsMock.mockResolvedValue({
      items: [{ region: "east" }],
      total: 1,
      offset: 0,
      limit: 200,
    });

    renderAt("/dashboards/dash-1/panels?token=valid-token");

    await waitFor(() => expect(screen.getByText("east")).toBeInTheDocument());
    await waitFor(() =>
      expect(fetchPublicDistinctValuesMock).toHaveBeenCalledWith(
        "dash-1",
        "panel-1",
        "valid-token",
        "region",
      ),
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Region" }));
    fireEvent.click(screen.getByRole("option", { name: "east" }));

    await waitFor(() =>
      expect(fetchPublicPanelRowsMock).toHaveBeenLastCalledWith(
        "dash-1",
        "panel-1",
        "valid-token",
        0,
        200,
        undefined,
        { ops: [{ column: "region", op: "eq", value: "east" }] },
      ),
    );
  });
});
