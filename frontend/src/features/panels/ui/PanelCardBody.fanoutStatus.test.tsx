// HEL-1094 (design.md D5, task 2.3) — the sr-only per-panel status region's accessible text must
// genuinely CHANGE across two fan-out-triggered refreshes, not merely be present in markup
// (Standing Constraint C4). Drives `usePanelData` through a REAL store + `panelsReducer` (rather
// than mocking the hook outright), since `PanelCardBody` is wrapped in `React.memo` — a directly
// mocked hook's return value changing across `render(...)` calls with the same `panel` prop would
// be invisible to it (memo bails on unchanged props), so a real store dispatch is what actually
// drives the internal re-render, exactly as it would in the running app.

import { configureStore } from "@reduxjs/toolkit";
import { act, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";

import { makeOutputPanel } from "../../../test/panelFixtures";
import * as outputService from "../../pipelines/services/outputService";
import { getOutputId } from "../state/panelNarrowing";
import { panelsReducer } from "../state/panelsSlice";
import { usePanelData } from "../hooks/usePanelData";
import { usePanelRunRefresh } from "../hooks/usePanelRunRefresh";
import { PanelCardBody } from "./PanelCard";
import type { Panel } from "../types/panel";

// HEL-579 design.md Decision 1: `PanelCardBody` no longer calls `usePanelData`
// itself -- this harness plays the role `PanelCard` plays in production (the
// single call site), so this test keeps driving a REAL store + `panelsReducer`
// (see the file-level comment above for why a real store, not a mocked hook,
// is what actually exercises the memo-visible re-render this suite tests).
function PanelCardBodyHarness({ panel }: { panel: Panel }) {
  const outputId = getOutputId(panel);
  const panelData = usePanelData(panel);
  return (
    <PanelCardBody
      panel={panel}
      frozen={false}
      outputId={outputId}
      data={panelData.data}
      rawRows={panelData.rawRows}
      headers={panelData.headers}
      isLoading={panelData.isLoading}
      error={panelData.error}
      errorKind={panelData.errorKind}
      noData={panelData.noData}
      neverMaterialized={panelData.neverMaterialized}
      chartAggregate={panelData.chartAggregate}
      rowsTruncated={panelData.rowsTruncated}
      refresh={panelData.refresh}
    />
  );
}

jest.mock("../hooks/usePanelPolling", () => ({
  usePanelPolling: jest.fn(),
}));

jest.mock("../hooks/usePanelRunRefresh", () => ({
  usePanelRunRefresh: jest.fn(),
}));

// `PanelContent` (rendered inside `PanelCardBody`) also resolves the Output's kind via
// `useOutputMeta`/`getOutputById` for its own kind-aware rendering — never-resolving here so it
// stays on its loading skeleton for the whole test, which is irrelevant to this test's concern
// (the sr-only status region, driven by `getOutputRows`/`usePanelData`, not by the Output's kind).
jest.mock("../../pipelines/services/outputService", () => ({
  getOutputById: jest.fn(() => new Promise(() => {})),
  getOutputRows: jest.fn(),
}));

const mockUsePanelRunRefresh = jest.mocked(usePanelRunRefresh);
const mockGetOutputRows = outputService.getOutputRows as jest.MockedFunction<
  typeof outputService.getOutputRows
>;

function makeStore(panel: ReturnType<typeof makeOutputPanel>) {
  return configureStore({
    reducer: { panels: panelsReducer } as never,
    preloadedState: {
      panels: {
        items: [panel],
        loadedDashboardId: "d1",
        status: "succeeded",
        error: null,
        pendingPanelUpdates: {},
        lastSavedAt: null,
        paginationState: {},
      },
    } as never,
  });
}

describe("PanelCardBody — fan-out refresh status region (HEL-1094 D5, task 2.3)", () => {
  beforeEach(() => {
    mockUsePanelRunRefresh.mockReset();
    mockGetOutputRows.mockReset();
  });

  it("changes the region's accessible text on each fan-out-triggered refresh, distinctly across two", async () => {
    let fanoutCallback: (() => void) | undefined;
    mockUsePanelRunRefresh.mockImplementation((_outputId, cb) => {
      fanoutCallback = cb;
    });

    mockGetOutputRows.mockResolvedValue({
      items: [{ n: 1 }],
      total: 1,
      offset: 0,
      limit: 200,
      materialized: true,
    });

    const panel = makeOutputPanel({ title: "Revenue", config: { outputId: "output-1" } });
    const store = makeStore(panel);
    render(
      <Provider store={store}>
        <PanelCardBodyHarness panel={panel} />
      </Provider>,
    );

    await waitFor(() => expect(mockGetOutputRows).toHaveBeenCalledTimes(1));

    const region = screen.getByRole("status");
    // Before any fan-out-triggered refresh, the region is empty.
    expect(region).toHaveTextContent("");
    expect(fanoutCallback).toBeDefined();

    // First fan-out refresh.
    act(() => {
      fanoutCallback?.();
    });
    await waitFor(() => expect(mockGetOutputRows).toHaveBeenCalledTimes(2));
    const firstAnnouncement = screen.getByRole("status").textContent;
    expect(firstAnnouncement).not.toBe("");

    // Second fan-out refresh — the text must change again, not just re-render unchanged.
    act(() => {
      fanoutCallback?.();
    });
    await waitFor(() => expect(mockGetOutputRows).toHaveBeenCalledTimes(3));
    const secondAnnouncement = screen.getByRole("status").textContent;
    expect(secondAnnouncement).not.toBe("");
    expect(secondAnnouncement).not.toBe(firstAnnouncement);
  });

  it("does not render the status region for a non-output panel", () => {
    mockUsePanelRunRefresh.mockImplementation(() => undefined);
    mockGetOutputRows.mockResolvedValue({
      items: [],
      total: 0,
      offset: 0,
      limit: 200,
      materialized: true,
    });

    const panel = { ...makeOutputPanel(), type: "text", config: { content: "hi" } } as never;
    const store = configureStore({
      reducer: { panels: panelsReducer } as never,
      preloadedState: {
        panels: {
          items: [panel],
          loadedDashboardId: "d1",
          status: "succeeded",
          error: null,
          pendingPanelUpdates: {},
          lastSavedAt: null,
          paginationState: {},
        },
      } as never,
    });

    render(
      <Provider store={store}>
        <PanelCardBodyHarness panel={panel} />
      </Provider>,
    );

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
