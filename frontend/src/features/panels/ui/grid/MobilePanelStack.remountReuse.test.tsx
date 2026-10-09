import { configureStore, type UnknownAction } from "@reduxjs/toolkit";
import { act, render, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { authReducer } from "../../../auth/state/authSlice";
import { defaultDashboardLayout } from "../../../dashboards/state/dashboardLayout";
import { toastsReducer } from "../../../toasts/state/toastsSlice";
import * as outputService from "../../../pipelines/services/outputService";
import { ThemeProvider } from "../../../../theme/ThemeProvider";
import { makeOutputPanel } from "../../../../test/panelFixtures";
import { makeOutput } from "../../../../test/remountFixtures";
import { ensureCapabilitiesLoaded } from "../../state/filterCapabilitiesStore";
import { panelsReducer } from "../../state/panelsSlice";
import type { Panel } from "../../types/panel";
import { MobilePanelStack } from "./MobilePanelStack";

// HEL-1392 design.md D2 (CR2) -- when metadata is already held but a mounting card has NO reusable
// window, exactly one fetcher owns the mount: the child's persisted-default / cross-filter
// correction, not the parent's stripped query as well.
jest.mock("../../../pipelines/services/outputService", () => ({
  ...jest.requireActual("../../../pipelines/services/outputService"),
  getOutputRows: jest.fn(),
  getOutputById: jest.fn(),
  getAssertionStatus: jest.fn(),
  getFilterCapabilities: jest.fn(),
  getDistinctValues: jest.fn(),
}));
jest.mock("../../hooks/usePanelPolling", () => ({ usePanelPolling: jest.fn() }));
jest.mock("../../services/pipelineRunFanout", () => ({
  subscribeToPipelineSucceeded: jest.fn(() => () => undefined),
  subscribeToPipelineTerminal: jest.fn(() => () => undefined),
  hasRunBaseline: jest.fn(() => true),
}));

const svc = jest.mocked(outputService);

const SORTED = makeOutput("o-sorted", "table", {
  fieldMapping: {},
  columnSort: { key: "revenue", direction: "desc" },
});
const PLAIN = makeOutput("o-plain", "table", { fieldMapping: {} });

function storeWith(panels: Panel[], crossFilter: unknown = null) {
  const seed = panelsReducer(undefined, { type: "@@INIT" } as UnknownAction);
  return configureStore({
    reducer: { panels: panelsReducer, toasts: toastsReducer, auth: authReducer } as never,
    preloadedState: {
      panels: { ...seed, items: panels, crossFilter },
      toasts: { items: [] },
      auth: authReducer(undefined, { type: "@@INIT" } as UnknownAction),
    } as never,
  });
}

function view(store: ReturnType<typeof storeWith>, panels: Panel[]) {
  const ui = (list: Panel[]) => (
    <StrictMode>
      <MemoryRouter>
        <Provider store={store}>
          <ThemeProvider>
            <MobilePanelStack panels={list} layout={defaultDashboardLayout} containerWidth={375} />
          </ThemeProvider>
        </Provider>
      </MemoryRouter>
    </StrictMode>
  );
  const rendered = render(ui(panels));
  return { setPanels: (list: Panel[]) => rendered.rerender(ui(list)) };
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 15; i++) await Promise.resolve();
  });
}

describe("MobilePanelStack mount ownership", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    svc.getOutputById.mockImplementation((id) =>
      Promise.resolve(id === "o-sorted" ? SORTED : PLAIN),
    );
    svc.getAssertionStatus.mockResolvedValue({ outputId: "x", invalid: false, failedRuleCount: 0 });
    svc.getOutputRows.mockResolvedValue({
      items: [{ region: "East", revenue: 1 }],
      total: 1,
      offset: 0,
      limit: 200,
      materialized: true,
    });
  });

  it("a second card on a persisted-sort Output (metadata held, no window) sends exactly one sorted request", async () => {
    const a = makeOutputPanel({ id: "a", config: { outputId: "o-sorted" } });
    const b = makeOutputPanel({ id: "b", config: { outputId: "o-sorted" } });
    const store = storeWith([a, b]);
    const v = view(store, [a]);
    await settle();
    svc.getOutputRows.mockClear();

    v.setPanels([a, b]);
    await settle();

    expect(svc.getOutputRows).toHaveBeenCalledTimes(1);
    expect(svc.getOutputRows.mock.calls[0][3]).toEqual({ column: "revenue", direction: "desc" });
    expect(store.getState().panels.paginationState["b"]?.lastQuery?.sort).toEqual({
      column: "revenue",
      direction: "desc",
    });
  });

  it("a second card under an active server cross-filter sends exactly one cross-filtered request", async () => {
    svc.getFilterCapabilities.mockResolvedValue({
      columns: [{ column: "region", operators: ["eq"] }],
    } as never);
    ensureCapabilitiesLoaded("o-plain");
    await settle();
    const a = makeOutputPanel({ id: "a", config: { outputId: "o-plain" } });
    const b = makeOutputPanel({ id: "b", config: { outputId: "o-plain" } });
    const crossFilter = { panelId: "origin", dimension: "region", value: "East" };
    const store = storeWith([a, b], crossFilter);
    const v = view(store, [a]);
    await settle();
    await waitFor(() => expect(store.getState().panels.paginationState["a"]).toBeDefined());
    svc.getOutputRows.mockClear();

    v.setPanels([a, b]);
    await settle();

    expect(svc.getOutputRows).toHaveBeenCalledTimes(1);
    expect(svc.getOutputRows.mock.calls[0][4]).toEqual({
      ops: [{ column: "region", op: "eq", value: "East" }],
    });
    expect(store.getState().panels.paginationState["b"]?.lastQuery?.crossFilterEq).toEqual({
      column: "region",
      value: "East",
    });
  });
});
