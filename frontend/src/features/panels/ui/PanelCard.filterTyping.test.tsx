// HEL-1027 skeptic-final-1.md (round 1, REFUTE) change request 3 — a regression test that
// exercises a REAL DOM typing sequence (multiple sequential keystrokes through the actual
// rendered input), not one direct `handleFilterChange`/`onFilterChange` call. This is the exact
// class of gap a programmatic single-call unit test (`usePanelSortFilter.test.ts`) cannot see:
// Defect 1 lived in the interaction between `DataGrid`'s per-keystroke `onChange`,
// `TableRenderer`'s local state, `usePanelSortFilter`'s (previously undebounced) refetch, and
// `PanelContent`'s `isLoading`-driven unmount — a defect that specifically requires a REAL
// component tree and REAL sequential keystrokes to reproduce or guard against.

import { configureStore, type UnknownAction } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { makeOutputPanel } from "../../../test/panelFixtures";
import { getOutputId } from "../state/panelNarrowing";
import { panelsReducer } from "../state/panelsSlice";
import { authReducer } from "../../auth/state/authSlice";
import { toastsReducer } from "../../toasts/state/toastsSlice";
import { usePanelData } from "../hooks/usePanelData";
import * as outputService from "../../pipelines/services/outputService";
import type { Output } from "../../pipelines/types/output";
import { PanelCardBody } from "./PanelCard";
import type { Panel } from "../types/panel";

jest.mock("../../pipelines/services/outputService", () => ({
  ...jest.requireActual("../../pipelines/services/outputService"),
  getOutputRows: jest.fn(),
  getOutputById: jest.fn(),
  getAssertionStatus: jest.fn(),
}));
jest.mock("../hooks/usePanelPolling", () => ({ usePanelPolling: jest.fn() }));
jest.mock("../hooks/usePanelRunRefresh", () => ({ usePanelRunRefresh: jest.fn() }));

const mockGetOutputRows = outputService.getOutputRows as jest.MockedFunction<
  typeof outputService.getOutputRows
>;
const mockGetOutputById = outputService.getOutputById as jest.MockedFunction<
  typeof outputService.getOutputById
>;
const mockGetAssertionStatus = outputService.getAssertionStatus as jest.MockedFunction<
  typeof outputService.getAssertionStatus
>;

function makeTableOutput(): Output {
  return {
    id: "output-1",
    pipelineId: "pipeline-1",
    ownerId: "u1",
    name: "Rows",
    kind: "table",
    config: { fieldMapping: {} },
    schema: [{ name: "label", type: "string" }],
    createdAt: "",
    updatedAt: "",
  };
}

// Mirrors `PanelCard`'s own real production wiring (the single `usePanelData` call site;
// `PanelCardBody` resolves its own `useOutputMeta` internally as of skeptic-final-3.md CR1 cycle
// 4 — no longer an externally-supplied prop), minus the header chrome this test doesn't need.
function Harness({ panel }: { panel: Panel }) {
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

function renderHarness(panel: Panel) {
  const store = makeStore(panel);
  render(
    <MemoryRouter>
      <Provider store={store}>
        <Harness panel={panel} />
      </Provider>
    </MemoryRouter>,
  );
  return store;
}

describe("PanelCard/TableRenderer — real DOM typing into the quick filter (HEL-1027 skeptic-final-1.md CR3)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockGetOutputById.mockResolvedValue(makeTableOutput());
    mockGetAssertionStatus.mockResolvedValue({
      outputId: "output-1",
      invalid: false,
      failedRuleCount: 0,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("typing a multi-character term one keystroke at a time keeps the input mounted throughout and sends the FULL term, not just the first character", async () => {
    mockGetOutputRows.mockResolvedValue({
      items: [{ label: "row-a" }, { label: "row-b" }],
      total: 2,
      offset: 0,
      limit: 200,
      materialized: true,
    });
    const panel = makeOutputPanel({ id: "panel-1" });
    const store = renderHarness(panel);

    // Let the initial (unfiltered) mount fetch resolve and the Output resolve, so TableRenderer
    // actually mounts.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    const quickInput = screen.getByRole("textbox", { name: "Quick filter across all columns" });

    // Real per-keystroke DOM typing: each `fireEvent.change` mirrors one more character
    // committed by a real keydown/input event, exactly as the browser would fire them.
    for (const partial of ["t", "ta", "tar", "targ", "targe", "target"]) {
      fireEvent.change(quickInput, { target: { value: partial } });
      // Advance LESS than the debounce window between keystrokes -- mirrors real fast typing.
      act(() => {
        jest.advanceTimersByTime(50);
      });
      // THE regression this test guards: the input must still be in the document, and must
      // still show what was just typed, after every single keystroke -- Defect 1 unmounted it
      // (into a full loading skeleton) starting from the SECOND keystroke.
      expect(screen.getByRole("textbox", { name: "Quick filter across all columns" })).toHaveValue(
        partial,
      );
    }

    mockGetOutputRows.mockClear();
    await act(async () => {
      jest.advanceTimersByTime(300);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Exactly one request fired for the whole typing burst, carrying the FULL final term.
    expect(mockGetOutputRows).toHaveBeenCalledTimes(1);
    expect(mockGetOutputRows).toHaveBeenCalledWith("output-1", 0, 200, undefined, {
      quick: "target",
      columns: {},
    });
    void store; // state already asserted via the DOM above
  });

  it("typing into a PER-COLUMN filter input has the same real-keystroke protection", async () => {
    mockGetOutputRows.mockResolvedValue({
      items: [{ label: "row-a" }],
      total: 1,
      offset: 0,
      limit: 200,
      materialized: true,
    });
    const panel = makeOutputPanel({ id: "panel-2" });
    renderHarness(panel);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    const columnInput = screen.getByRole("textbox", { name: "Filter column label" });

    for (const partial of ["r", "ro", "row"]) {
      fireEvent.change(columnInput, { target: { value: partial } });
      act(() => {
        jest.advanceTimersByTime(50);
      });
      expect(screen.getByRole("textbox", { name: "Filter column label" })).toHaveValue(partial);
    }

    mockGetOutputRows.mockClear();
    await act(async () => {
      jest.advanceTimersByTime(300);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockGetOutputRows).toHaveBeenCalledTimes(1);
    expect(mockGetOutputRows).toHaveBeenCalledWith("output-1", 0, 200, undefined, {
      quick: "",
      columns: { label: "row" },
    });
  });
});
