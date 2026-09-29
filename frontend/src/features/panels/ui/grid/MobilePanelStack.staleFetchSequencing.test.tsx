// HEL-1027 skeptic-final-3.md (round 3, REFUTE) CR2 (cycle 4) — the persisted-filter-default
// count-staleness defect `skeptic-final-2.md` reported is REPRODUCIBLE, deterministically, ONLY
// through `MobilePanelStack`/`MobileStackPanelBody`, never through `PanelCard` — neither case in
// `PanelCard.staleFetchSequencing.test.tsx` can ever catch it, since both exercise the desktop
// component exclusively. Root cause (skeptic-final-3.md): `MobileStackPanelBody` never threaded
// a resolved `Output` into `PanelCardBody`/`usePanelSortFilter`, so the persisted-default
// correction effect's own guard (`seededOutputId === null` -> return) never cleared on the
// phone-stack path — categorically, not as a race. Fixed in `PanelCard.tsx` by having
// `PanelCardBody` resolve its OWN `useOutputMeta(outputId)` (shared by both the desktop grid and
// the phone stack, since `PanelCardBody` is the actual common ancestor), rather than relying on
// an externally-supplied `output` prop that only the desktop path ever populated.

import { configureStore, type UnknownAction } from "@reduxjs/toolkit";
import { act, render, screen } from "@testing-library/react";

import { defaultDashboardLayout } from "../../../dashboards/state/dashboardLayout";
import { makeOutputPanel } from "../../../../test/panelFixtures";
import { panelsReducer } from "../../state/panelsSlice";
import { authReducer } from "../../../auth/state/authSlice";
import { toastsReducer } from "../../../toasts/state/toastsSlice";
import { ThemeProvider } from "../../../../theme/ThemeProvider";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import * as outputService from "../../../pipelines/services/outputService";
import type { Output } from "../../../pipelines/types/output";
import { MobilePanelStack } from "./MobilePanelStack";
import type { Panel } from "../../types/panel";

jest.mock("../../../pipelines/services/outputService", () => ({
  ...jest.requireActual("../../../pipelines/services/outputService"),
  getOutputRows: jest.fn(),
  getOutputById: jest.fn(),
  getAssertionStatus: jest.fn(),
}));
jest.mock("../../hooks/usePanelPolling", () => ({ usePanelPolling: jest.fn() }));
jest.mock("../../hooks/usePanelRunRefresh", () => ({ usePanelRunRefresh: jest.fn() }));

const mockGetOutputRows = outputService.getOutputRows as jest.MockedFunction<
  typeof outputService.getOutputRows
>;
const mockGetOutputById = outputService.getOutputById as jest.MockedFunction<
  typeof outputService.getOutputById
>;
const mockGetAssertionStatus = outputService.getAssertionStatus as jest.MockedFunction<
  typeof outputService.getAssertionStatus
>;

function makeFilteredTableOutput(): Output {
  return {
    id: "output-1",
    pipelineId: "pipeline-1",
    ownerId: "u1",
    name: "Rows",
    kind: "table",
    // A PERSISTED quick filter — the exact scenario skeptic-final-2.md/skeptic-final-3.md
    // live-reproduced (fresh reload of a table panel with a saved `columnFilters` default).
    config: { fieldMapping: {}, columnFilters: { quick: "t" } },
    schema: [{ name: "label", type: "string" }],
    createdAt: "",
    updatedAt: "",
  };
}

function makeStore(panel: Panel) {
  const seed = panelsReducer(undefined, { type: "@@INIT" } as UnknownAction);
  const authSeed = authReducer(undefined, { type: "@@INIT" } as UnknownAction);
  return configureStore({
    reducer: { panels: panelsReducer, toasts: toastsReducer, auth: authReducer } as never,
    preloadedState: {
      panels: { ...seed, items: [panel] },
      toasts: { items: [] },
      auth: authSeed,
    } as never,
  });
}

describe("MobilePanelStack/MobileStackPanelBody — persisted-filter-default correction (HEL-1027 skeptic-final-3.md CR2)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetOutputById.mockResolvedValue(makeFilteredTableOutput());
    mockGetAssertionStatus.mockResolvedValue({
      outputId: "output-1",
      invalid: false,
      failedRuleCount: 0,
    });
  });

  it("fires the corrective filtered fetch and settles on the server's FILTERED total when rendered through the phone stack, not just the desktop grid", async () => {
    mockGetOutputRows.mockImplementation((_outputId, _offset, _limit, _sort, filter) => {
      if (filter) {
        return Promise.resolve({
          items: [{ label: "target1" }, { label: "target2" }, { label: "target3" }],
          total: 3,
          offset: 0,
          limit: 200,
          materialized: true,
        });
      }
      return Promise.resolve({
        items: Array.from({ length: 60 }, (_, i) => ({ label: `row-${i}` })),
        total: 60,
        offset: 0,
        limit: 200,
        materialized: true,
      });
    });

    const panel = makeOutputPanel({ id: "panel-mobile-stale" });
    const store = makeStore(panel);

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

    // Let every mount-effect fetch settle: `usePanelData`'s own unfiltered fetch, `useOutputMeta`,
    // and (once fixed) `usePanelSortFilter`'s persisted-default correction fetch.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // The corrective, FILTERED request must actually have been issued — this is the assertion
    // that was categorically impossible to satisfy before the fix (`seededOutputId` stayed
    // `null` forever on this code path, so `usePanelSortFilter`'s effect never even attempted a
    // fetch), not merely a race that sometimes lost.
    const filteredCalls = mockGetOutputRows.mock.calls.filter(([, , , , filter]) => !!filter);
    expect(filteredCalls.length).toBeGreaterThanOrEqual(1);

    expect(store.getState().panels.paginationState["panel-mobile-stale"]?.total).toBe(3);
    await screen.findByText("3 results.");
  });
});
