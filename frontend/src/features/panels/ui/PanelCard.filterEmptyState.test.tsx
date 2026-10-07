// HEL-1027 design.md D10 (task 4.7, owner-ruled scope addition, skeptic-design-5.md CR2) — the
// required RED-FIRST proof (Iron Law: systematic-debugging.md): a table panel with a PERSISTED
// filter that legitimately matches zero rows of a real, materialized Output must render
// `TableRenderer`'s own "No rows match your filter." + "Clear filters" empty state, never
// `PanelContent`'s generic top-level "No data available" short-circuit (`PanelContent.tsx:372`),
// which drops the filter UI and Clear-filters affordance entirely.

import { screen } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import { makeOutputPanel } from "../../../test/panelFixtures";
import { getOutputById as getOutputByIdRequest } from "../../pipelines/services/outputService";
import { usePanelData } from "../hooks/usePanelData";
import { usePanelPolling } from "../hooks/usePanelPolling";
import { usePanelRunRefresh } from "../hooks/usePanelRunRefresh";
import type { Output } from "../../pipelines/types/output";
import { PanelCard } from "./PanelCard";

jest.mock("../hooks/usePanelData", () => ({ usePanelData: jest.fn() }));
jest.mock("../hooks/usePanelPolling", () => ({ usePanelPolling: jest.fn() }));
jest.mock("../hooks/usePanelRunRefresh", () => ({ usePanelRunRefresh: jest.fn() }));
jest.mock("../../pipelines/services/outputService", () => ({
  ...jest.requireActual("../../pipelines/services/outputService"),
  getAssertionStatus: jest.fn(() => new Promise(() => {})),
  getOutputById: jest.fn(),
}));

const mockUsePanelData = jest.mocked(usePanelData);
const mockUsePanelPolling = jest.mocked(usePanelPolling);
const mockUsePanelRunRefresh = jest.mocked(usePanelRunRefresh);
const getOutputByIdMock = jest.mocked(getOutputByIdRequest);

// A real Output with a genuine `node_snapshots` write (`materialized: true`, unrelated to this
// test's filter) — the D5 "distinguishable from never-run" concern is orthogonal to D10 and must
// stay unaffected by it (verified separately below).
function makeFilteredTableOutput(): Output {
  return {
    id: "output-1",
    pipelineId: "pipe-1",
    ownerId: "u1",
    name: "Customers",
    kind: "table",
    // A PERSISTED quick filter that matches nothing across the whole (real) Output.
    config: { fieldMapping: {}, columnFilters: { quick: "nonexistent-term" } },
    schema: [{ name: "name", type: "string" }],
    createdAt: "",
    updatedAt: "",
  };
}

function renderZeroMatchFilteredPanel(panelId: string) {
  const panel = makeOutputPanel({ id: panelId, title: "Customers" });
  return renderWithStore(
    <PanelCard
      panel={panel}
      theme="dark"
      isDragging={false}
      dashboardId="dashboard-1"
      isEditingTitle={false}
      editingTitle=""
      editingTitleError={null}
      isConfirmingDelete={false}
      onMouseDown={jest.fn()}
      onCardClick={jest.fn()}
      onStartEdit={jest.fn()}
      onTitleChange={jest.fn()}
      onTitleKeyDown={jest.fn()}
      onTitleBlur={jest.fn()}
      onRequestDelete={jest.fn()}
      onCancelDelete={jest.fn()}
      onDetail={jest.fn()}
    />,
    {
      panels: {
        items: [panel],
        // Mirrors what a real filtered `fetchPanelPage(page: 0)` response looks like once D5's
        // fix ships: zero rows, zero total, but `materialized: true` (real data, just no match).
        paginationState: {
          [panelId]: {
            currentPage: 0,
            hasMore: false,
            isLoadingMore: false,
            rows: [],
            materialized: true,
            total: 0,
          },
        },
      },
    },
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUsePanelPolling.mockReturnValue(undefined);
  mockUsePanelRunRefresh.mockReturnValue(undefined);
  // `usePanelData`'s own `noData` derivation: `paginationEntry != null && rows.length === 0 &&
  // !error` — mirrors the real hook's output for the zero-row/materialized:true pagination state
  // seeded above.
  mockUsePanelData.mockReturnValue({
    data: null,
    rawRows: null,
    headers: null,
    isLoading: false,
    error: null,
    errorKind: null,
    noData: true,
    neverMaterialized: false,
    rowsTruncated: false,
    refresh: jest.fn(),
    isRefreshing: false,
  });
});

describe("PanelCard — filter-aware empty state (HEL-1027 D10, task 4.7)", () => {
  it("renders TableRenderer's own filtered-empty state, not the generic 'No data available' short-circuit", async () => {
    getOutputByIdMock.mockResolvedValue(makeFilteredTableOutput());
    renderZeroMatchFilteredPanel("panel-1");

    // GREEN: the table's own in-grid empty state, with a working Clear-filters affordance.
    await screen.findByText("No rows match your filter.");
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();

    // Never the generic top-level short-circuit this fix bypasses.
    expect(screen.queryByText("No data available")).not.toBeInTheDocument();
  });

  // D10's own stated boundary: this fix changes which RENDER PATH is taken, never the
  // `materialized` VALUE itself — an unfiltered empty/never-run Output must render completely
  // unaffected by this change.
  it("an UNFILTERED never-materialized Output is unaffected — still renders the generic empty state", async () => {
    getOutputByIdMock.mockResolvedValue({
      id: "output-2",
      pipelineId: "pipe-1",
      ownerId: "u1",
      name: "Untouched",
      kind: "table",
      config: { fieldMapping: {} },
      schema: [],
      createdAt: "",
      updatedAt: "",
    });
    mockUsePanelData.mockReturnValue({
      data: null,
      rawRows: null,
      headers: null,
      isLoading: false,
      error: null,
      errorKind: null,
      noData: true,
      neverMaterialized: true,
      rowsTruncated: false,
      refresh: jest.fn(),
      isRefreshing: false,
    });
    const panel = makeOutputPanel({ id: "panel-2", title: "Untouched" });
    renderWithStore(
      <PanelCard
        panel={panel}
        theme="dark"
        isDragging={false}
        dashboardId="dashboard-1"
        isEditingTitle={false}
        editingTitle=""
        editingTitleError={null}
        isConfirmingDelete={false}
        onMouseDown={jest.fn()}
        onCardClick={jest.fn()}
        onStartEdit={jest.fn()}
        onTitleChange={jest.fn()}
        onTitleKeyDown={jest.fn()}
        onTitleBlur={jest.fn()}
        onRequestDelete={jest.fn()}
        onCancelDelete={jest.fn()}
        onDetail={jest.fn()}
      />,
      { panels: { items: [panel] } },
    );

    expect(await screen.findByText("Not run yet")).toBeInTheDocument();
    expect(screen.queryByText("No rows match your filter.")).not.toBeInTheDocument();
  });
});
