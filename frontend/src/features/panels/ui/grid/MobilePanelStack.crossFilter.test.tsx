// HEL-1191 design.md D9a (a)/(b), tasks 5.5/5.6 — the phone stack's `MobileStackPanelBody` calls
// the ops-less `usePanelData(panel)` and deliberately owns no Output. A server-applied cross-filter
// must therefore survive (a) a breakpoint REMOUNT and (b) a refresh (poll / SSE fan-out) through
// `paginationState.lastQuery` replay, never rendering unfiltered sibling rows in between.

import { configureStore, type UnknownAction } from "@reduxjs/toolkit";
import { act, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { defaultDashboardLayout } from "../../../dashboards/state/dashboardLayout";
import { makeOutputPanel } from "../../../../test/panelFixtures";
import { panelsReducer } from "../../state/panelsSlice";
import { resetCapabilitiesStoreForTests } from "../../state/filterCapabilitiesStore";
import { authReducer } from "../../../auth/state/authSlice";
import { toastsReducer } from "../../../toasts/state/toastsSlice";
import { ThemeProvider } from "../../../../theme/ThemeProvider";
import * as outputService from "../../../pipelines/services/outputService";
import { usePanelRunRefresh } from "../../hooks/usePanelRunRefresh";
import type { Output } from "../../../pipelines/types/output";
import type { Panel } from "../../types/panel";
import { MobilePanelStack } from "./MobilePanelStack";

jest.mock("../../../pipelines/services/outputService", () => ({
  ...jest.requireActual("../../../pipelines/services/outputService"),
  getOutputRows: jest.fn(),
  getOutputById: jest.fn(),
  getAssertionStatus: jest.fn(),
  getFilterCapabilities: jest.fn(),
  getDistinctValues: jest.fn(),
}));
jest.mock("../../hooks/usePanelPolling", () => ({ usePanelPolling: jest.fn() }));
jest.mock("../../hooks/usePanelRunRefresh", () => ({ usePanelRunRefresh: jest.fn() }));

const getOutputRows = jest.mocked(outputService.getOutputRows);
const getOutputById = jest.mocked(outputService.getOutputById);
const getAssertionStatus = jest.mocked(outputService.getAssertionStatus);
const getFilterCapabilities = jest.mocked(outputService.getFilterCapabilities);
const mockUsePanelRunRefresh = jest.mocked(usePanelRunRefresh);

const output: Output = {
  id: "output-1",
  pipelineId: "pipeline-1",
  ownerId: "u1",
  name: "Rows",
  kind: "table",
  config: { columnOrder: ["quarter", "idx"] },
  schema: [
    { name: "quarter", type: "string" },
    { name: "idx", type: "integer" },
  ],
  createdAt: "",
  updatedAt: "",
};

const ALL = Array.from({ length: 250 }, (_, i) => ({ quarter: i % 5 === 0 ? "Q1" : "Q2", idx: i }));

const hasEq = (call: unknown[]) =>
  ((call[4] as { ops?: { op: string }[] } | undefined)?.ops ?? []).some((o) => o.op === "eq");

function makeStore(panel: Panel) {
  const seed = panelsReducer(undefined, { type: "@@INIT" } as UnknownAction);
  return configureStore({
    reducer: { panels: panelsReducer, toasts: toastsReducer, auth: authReducer } as never,
    preloadedState: {
      panels: {
        ...seed,
        items: [panel],
        crossFilter: { panelId: "origin", dimension: "quarter", value: "Q1", series: "" },
      },
      toasts: { items: [] },
      auth: authReducer(undefined, { type: "@@INIT" } as UnknownAction),
    } as never,
  });
}

function stack(panel: Panel, store: ReturnType<typeof makeStore>) {
  return (
    <MemoryRouter>
      <Provider store={store}>
        <ThemeProvider>
          <MobilePanelStack panels={[panel]} layout={defaultDashboardLayout} containerWidth={375} />
        </ThemeProvider>
      </Provider>
    </MemoryRouter>
  );
}

describe("MobilePanelStack — HEL-1191 cross-filter survives remount and refresh", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetCapabilitiesStoreForTests();
    getOutputById.mockResolvedValue(output);
    getAssertionStatus.mockResolvedValue({
      outputId: "output-1",
      invalid: false,
      failedRuleCount: 0,
    });
    getFilterCapabilities.mockResolvedValue({
      columns: [{ column: "quarter", operators: ["eq"] }],
    });
    getOutputRows.mockImplementation((_id, offset = 0, limit = 50, _sort, filter) => {
      let rows = ALL;
      for (const op of filter?.ops ?? []) {
        if (op.op === "eq")
          rows = rows.filter((r) => String(r[op.column as "quarter"]) === op.value);
      }
      return Promise.resolve({
        items: rows.slice(offset, offset + limit),
        total: rows.length,
        offset,
        limit,
        materialized: true,
      });
    });
  });

  it("a breakpoint remount never dispatches an unfiltered read nor renders unfiltered sibling rows", async () => {
    const panel = makeOutputPanel({ id: "panel-mobile" });
    const store = makeStore(panel);
    const first = render(stack(panel, store));
    await waitFor(() =>
      expect(store.getState().panels.paginationState["panel-mobile"]?.total).toBe(50),
    );
    await waitFor(() =>
      expect(store.getState().panels.paginationState["panel-mobile"]?.isLoadingMore).toBe(false),
    );

    // Breakpoint change: the stack unmounts, then mounts again. Redux state survives.
    first.unmount();
    getOutputRows.mockClear();
    const snapshots: string[] = [];
    const unsubscribe = store.subscribe(() => {
      const entry = store.getState().panels.paginationState["panel-mobile"];
      snapshots.push(JSON.stringify(entry?.rows.map((r: Record<string, unknown>) => r.quarter)));
    });
    render(stack(panel, store));
    await waitFor(() => expect(getOutputRows).toHaveBeenCalled());
    await waitFor(() =>
      expect(store.getState().panels.paginationState["panel-mobile"]?.isLoadingMore).toBe(false),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    unsubscribe();

    // Every read after the remount carries the eq; the store never held a non-Q1 row.
    expect(getOutputRows.mock.calls.length).toBeGreaterThan(0);
    expect(getOutputRows.mock.calls.every(hasEq)).toBe(true);
    expect(snapshots.some((s) => s.includes("Q2"))).toBe(false);
    expect(store.getState().panels.paginationState["panel-mobile"].total).toBe(50);
    expect(screen.queryByText("Q2")).not.toBeInTheDocument();
  });

  it("a refresh (SSE fan-out / poll) on the mobile host keeps the eq", async () => {
    let fanout: (() => void) | undefined;
    mockUsePanelRunRefresh.mockImplementation((_id, cb) => {
      fanout = cb;
    });
    const panel = makeOutputPanel({ id: "panel-mobile" });
    const store = makeStore(panel);
    render(stack(panel, store));
    await waitFor(() =>
      expect(store.getState().panels.paginationState["panel-mobile"]?.total).toBe(50),
    );
    await waitFor(() =>
      expect(store.getState().panels.paginationState["panel-mobile"]?.isLoadingMore).toBe(false),
    );
    getOutputRows.mockClear();

    act(() => fanout?.());
    await waitFor(() => expect(getOutputRows).toHaveBeenCalled());
    await waitFor(() =>
      expect(store.getState().panels.paginationState["panel-mobile"]?.isLoadingMore).toBe(false),
    );

    expect(getOutputRows.mock.calls.every(hasEq)).toBe(true);
    expect(store.getState().panels.paginationState["panel-mobile"].total).toBe(50);
  });
});
