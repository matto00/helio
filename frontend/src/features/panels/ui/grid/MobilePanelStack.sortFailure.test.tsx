import { configureStore, type UnknownAction } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { authReducer } from "../../../auth/state/authSlice";
import { defaultDashboardLayout } from "../../../dashboards/state/dashboardLayout";
import { toastsReducer } from "../../../toasts/state/toastsSlice";
import * as outputService from "../../../pipelines/services/outputService";
import { ThemeProvider } from "../../../../theme/ThemeProvider";
import { makeOutputPanel } from "../../../../test/panelFixtures";
import { makeOutput } from "../../../../test/remountFixtures";
import { panelsReducer } from "../../state/panelsSlice";
import { MobilePanelStack } from "./MobilePanelStack";

// HEL-1392 Verification 3(g) at card level -- a failed USER-driven sort refetch is toast-only: the
// table and its filter control stay mounted and no error state replaces them, even though the
// failure is now recorded on the pagination entry.
jest.mock("../../../pipelines/services/outputService", () => ({
  ...jest.requireActual("../../../pipelines/services/outputService"),
  getOutputRows: jest.fn(),
  getOutputById: jest.fn(),
  getAssertionStatus: jest.fn(),
}));
jest.mock("../../hooks/usePanelPolling", () => ({ usePanelPolling: jest.fn() }));
jest.mock("../../services/pipelineRunFanout", () => ({
  subscribeToPipelineSucceeded: jest.fn(() => () => undefined),
  subscribeToPipelineTerminal: jest.fn(() => () => undefined),
  hasRunBaseline: jest.fn(() => true),
}));

const svc = jest.mocked(outputService);

describe("a failed user-driven sort refetch", () => {
  it("shows the toast and keeps the table and its filter control mounted, with no error state", async () => {
    svc.getOutputById.mockResolvedValue(makeOutput("o1", "table", { fieldMapping: {} }));
    svc.getAssertionStatus.mockResolvedValue({
      outputId: "o1",
      invalid: false,
      failedRuleCount: 0,
    });
    const rows = {
      items: [
        { region: "East", revenue: 1 },
        { region: "West", revenue: 2 },
      ],
      total: 2,
      offset: 0,
      limit: 200,
      materialized: true,
    };
    svc.getOutputRows.mockResolvedValueOnce(rows);
    const panel = makeOutputPanel({ id: "p", config: { outputId: "o1" } });
    const seed = panelsReducer(undefined, { type: "@@INIT" } as UnknownAction);
    const store = configureStore({
      reducer: { panels: panelsReducer, toasts: toastsReducer, auth: authReducer } as never,
      preloadedState: {
        panels: { ...seed, items: [panel] },
        toasts: { items: [] },
        auth: authReducer(undefined, { type: "@@INIT" } as UnknownAction),
      } as never,
    });
    render(
      <MemoryRouter>
        <Provider store={store}>
          <ThemeProvider>
            <MobilePanelStack
              panels={[panel]}
              layout={defaultDashboardLayout}
              containerWidth={375}
            />
          </ThemeProvider>
        </Provider>
      </MemoryRouter>,
    );
    await screen.findByText("East");

    svc.getOutputRows.mockRejectedValueOnce(new Error("sort failed"));
    const header = screen
      .getAllByRole("columnheader")
      .filter(
        (th) => !th.closest(".ui-data-grid__filter-row, .ui-data-grid__filter-toggle-row"),
      )[0];
    await act(async () => {
      fireEvent.click(header.querySelector("button") as HTMLElement);
    });
    await waitFor(() => expect(store.getState().toasts.items.length).toBe(1), { timeout: 3000 });

    expect(store.getState().toasts.items[0].variant).toBe("error");
    expect(screen.getByText("East")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filters" })).toBeInTheDocument();
    expect(screen.queryByText(/Failed to load/)).not.toBeInTheDocument();
    expect(store.getState().panels.paginationState["p"]?.lastError).not.toBeNull();
  });
});
