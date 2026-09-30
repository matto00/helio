import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { AxiosError, type AxiosResponse } from "axios";

import { renderWithStore } from "../../../test/renderWithStore";
import { makeOutputPanel } from "../../../test/panelFixtures";
import {
  getFilterCapabilities,
  getOutputById,
  getOutputRows,
} from "../../pipelines/services/outputService";
import type { OutputRowsFilter } from "../../pipelines/services/outputService";
import type { Output } from "../../pipelines/types/output";
import { clearCrossFilter } from "../state/panelsSlice";
import { resetCapabilitiesStoreForTests } from "../state/filterCapabilitiesStore";
import type { OutputControlSpec, PanelPaginationState } from "../types/panel";
import { usePanelRunRefresh } from "../hooks/usePanelRunRefresh";
import { getCapabilitiesEntry } from "../state/filterCapabilitiesStore";
import { PanelCard } from "./PanelCard";

// HEL-1191 task 1.1 — RED-FIRST: a cross-filtered table bound to an Output larger than one page
// must report the WHOLE-Output match count / `hasMore` of the filtered set, not the loaded
// window's. Uses the real `usePanelData` + `fetchPanelPage` + reducer against a faked server.

jest.mock("../hooks/usePanelPolling", () => ({ usePanelPolling: jest.fn() }));
jest.mock("../hooks/usePanelRunRefresh", () => ({ usePanelRunRefresh: jest.fn() }));
jest.mock("../../pipelines/services/outputService", () => ({
  ...jest.requireActual("../../pipelines/services/outputService"),
  getAssertionStatus: jest.fn(() => new Promise(() => {})),
  getDistinctValues: jest.fn(() => Promise.resolve({ column: "", values: [] })),
  getOutputById: jest.fn(),
  getOutputRows: jest.fn(),
  getFilterCapabilities: jest.fn(),
}));

const mockUsePanelRunRefresh = jest.mocked(usePanelRunRefresh);
const getOutputByIdMock = jest.mocked(getOutputById);
const getOutputRowsMock = jest.mocked(getOutputRows);
const getFilterCapabilitiesMock = jest.mocked(getFilterCapabilities);

type Row = Record<string, unknown>;
type Result = Awaited<ReturnType<typeof getOutputRows>>;

let allRows: Row[] = [];

/** 250 rows, every 5th "Q1" -> 50 Q1 rows; the first 200-row page holds 40 of them. */
function smallOutputRows(): Row[] {
  return Array.from({ length: 250 }, (_, i) => ({ quarter: i % 5 === 0 ? "Q1" : "Q2", idx: i }));
}

function hasEq(filter?: OutputRowsFilter): boolean {
  return (filter?.ops ?? []).some((o) => o.op === "eq");
}

/** A faked server honouring `eq` ops; `total` is the whole (filtered) Output. */
function serve(offset: number, limit: number, filter?: OutputRowsFilter): Promise<Result> {
  let rows = allRows;
  for (const op of filter?.ops ?? []) {
    if (op.op === "eq") rows = rows.filter((r) => String(r[op.column]) === op.value);
  }
  return Promise.resolve({
    items: rows.slice(offset, offset + limit),
    total: rows.length,
    offset,
    limit,
    materialized: true,
  });
}

function eqCalls() {
  return getOutputRowsMock.mock.calls.filter((c) => hasEq(c[4]));
}

function makeAxios400(): AxiosError {
  return new AxiosError("Bad Request", "ERR_BAD_REQUEST", undefined, undefined, {
    status: 400,
    data: { message: "eq not allowed" },
  } as AxiosResponse);
}

function tableOutput(overrides: Partial<Output> = {}): Output {
  return {
    id: "output-1",
    pipelineId: "pipe-1",
    ownerId: "u1",
    name: "Revenue",
    kind: "table",
    config: { fieldMapping: {}, columnOrder: ["quarter", "idx"] },
    schema: [
      { name: "quarter", type: "string" },
      { name: "idx", type: "integer" },
    ],
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

const EQ_CAPABLE = { columns: [{ column: "quarter", operators: ["eq", "in"] as never }] };

beforeEach(() => {
  jest.clearAllMocks();
  resetCapabilitiesStoreForTests();
  allRows = smallOutputRows();
  getOutputByIdMock.mockResolvedValue(tableOutput());
  getFilterCapabilitiesMock.mockResolvedValue(EQ_CAPABLE);
  getOutputRowsMock.mockImplementation((_id, offset = 0, limit = 50, _sort, filter) =>
    serve(offset, limit, filter),
  );
});

function renderCard(
  options: {
    panelId?: string;
    crossFilter?: { dimension: string; value: string } | null;
    paginationState?: Record<string, PanelPaginationState>;
    controls?: OutputControlSpec[];
    path?: string;
  } = {},
) {
  const panelId = options.panelId ?? "panel-sibling";
  const panel = makeOutputPanel({
    id: panelId,
    title: "Revenue",
    config: { controls: options.controls ?? [] },
  });
  const cross =
    options.crossFilter === undefined ? { dimension: "quarter", value: "Q1" } : options.crossFilter;
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
        crossFilter: cross ? { panelId: "origin-panel", series: "", ...cross } : null,
        ...(options.paginationState ? { paginationState: options.paginationState } : {}),
      },
    },
    options.path ?? "/",
  );
}

function entryOf(store: ReturnType<typeof renderCard>["store"]): PanelPaginationState {
  return store.getState().panels.paginationState["panel-sibling"] as PanelPaginationState;
}

async function settled(store: ReturnType<typeof renderCard>["store"], total: number) {
  await waitFor(() => {
    const e = entryOf(store);
    expect(e?.isLoadingMore).toBe(false);
    expect(e?.total).toBe(total);
  });
}

describe("PanelCard — HEL-1191 server-side cross-filter", () => {
  // Task 1.1 — RED-FIRST (recorded against current main in evidence.md): on main the filter only
  // narrowed the loaded window client-side, so the panel's `total` stayed the raw Output total.
  it("a cross-filtered table over a multi-page Output reports the whole-Output match count and hasMore of the filtered set", async () => {
    const { store } = renderCard();

    await settled(store, 50);
    expect(entryOf(store).hasMore).toBe(false);
    expect(entryOf(store).rows).toHaveLength(50);
    expect(allRows.length).toBeGreaterThan(200);
    expect(
      await screen.findByText("50 results match the dashboard filter, quarter = Q1."),
    ).toBeInTheDocument();
    // The server path never renders the client-side loaded-scope disclosure.
    expect(screen.queryByText(/loaded rows match/)).not.toBeInTheDocument();
    // The eq op travelled on the Output read.
    expect(eqCalls().length).toBeGreaterThan(0);
    expect(eqCalls()[0][4]).toEqual({ ops: [{ column: "quarter", op: "eq", value: "Q1" }] });
  });

  it("keeps today's client-side loaded-rows narrowing + disclosure when the contract disallows eq on the dimension", async () => {
    getFilterCapabilitiesMock.mockResolvedValue({
      columns: [{ column: "quarter", operators: ["contains"] }],
    });
    const { store } = renderCard();

    await settled(store, 250);
    expect(await screen.findByText("40 of 200 loaded rows match.")).toBeInTheDocument();
    expect(eqCalls()).toHaveLength(0);
  });

  it("takes the client fallback for a timestamp-typed column even if the contract lists eq", async () => {
    getOutputByIdMock.mockResolvedValue(
      tableOutput({
        schema: [
          { name: "quarter", type: "timestamp" },
          { name: "idx", type: "integer" },
        ],
      }),
    );
    const { store } = renderCard();

    await settled(store, 250);
    expect(await screen.findByText("40 of 200 loaded rows match.")).toBeInTheDocument();
    expect(eqCalls()).toHaveLength(0);
  });

  it("takes the client fallback when the capabilities request fails", async () => {
    getFilterCapabilitiesMock.mockRejectedValue(new Error("boom"));
    const { store } = renderCard();

    await settled(store, 250);
    expect(await screen.findByText("40 of 200 loaded rows match.")).toBeInTheDocument();
    expect(eqCalls()).toHaveLength(0);
  });

  it("never sends the eq for the originating panel and never even fetches capabilities for it", async () => {
    const { store } = renderCard({ panelId: "origin-panel" });
    await waitFor(() =>
      expect(store.getState().panels.paginationState["origin-panel"]?.total).toBe(250),
    );

    expect(eqCalls()).toHaveLength(0);
    expect(getFilterCapabilitiesMock).not.toHaveBeenCalled();
  });

  it("leaves a panel whose field mapping does not reference the dimension unaffected (no eq, no capabilities fetch)", async () => {
    getOutputByIdMock.mockResolvedValue(tableOutput({ config: { columnOrder: ["idx"] } }));
    const { store } = renderCard();

    await settled(store, 250);
    expect(eqCalls()).toHaveLength(0);
    expect(getFilterCapabilitiesMock).not.toHaveBeenCalled();
  });

  it("is lazy: with no active cross-filter no capabilities request is made", async () => {
    const { store } = renderCard({ crossFilter: null });

    await settled(store, 250);
    expect(getFilterCapabilitiesMock).not.toHaveBeenCalled();
  });

  it("clearing while the filtered response is still in flight restores the unfiltered state and the stale filtered response never wins", async () => {
    let resolveFiltered: ((r: Result) => void) | undefined;
    getOutputRowsMock.mockImplementation((_id, offset = 0, limit = 50, _sort, filter) => {
      if (hasEq(filter)) {
        return new Promise<Result>((resolve) => {
          resolveFiltered = resolve;
        });
      }
      return serve(offset, limit, filter);
    });
    const { store } = renderCard();
    await waitFor(() => expect(resolveFiltered).toBeDefined());

    act(() => {
      store.dispatch(clearCrossFilter());
    });
    await settled(store, 250);

    // The stale filtered response now lands.
    await act(async () => {
      resolveFiltered?.({
        items: allRows.filter((r) => r.quarter === "Q1"),
        total: 50,
        offset: 0,
        limit: 200,
        materialized: true,
      });
    });
    expect(entryOf(store).total).toBe(250);
    expect(entryOf(store).rows).toHaveLength(200);
    expect(entryOf(store).lastQuery?.crossFilterEq).toBeNull();
  });

  it("announces the filtered state only after the fetch settles, then announces the clearing", async () => {
    let resolveFiltered: (() => void) | undefined;
    getOutputRowsMock.mockImplementation((_id, offset = 0, limit = 50, _sort, filter) => {
      if (hasEq(filter)) {
        return new Promise<Result>((resolve) => {
          resolveFiltered = () =>
            resolve({
              items: allRows.filter((r) => r.quarter === "Q1"),
              total: 50,
              offset,
              limit,
              materialized: true,
            });
        });
      }
      return serve(offset, limit, filter);
    });
    const { store } = renderCard();
    await waitFor(() => expect(resolveFiltered).toBeDefined());
    // Loading: nothing announced yet.
    expect(screen.getByRole("status").textContent ?? "").not.toMatch(/match the dashboard filter/);

    await act(async () => {
      resolveFiltered?.();
    });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "50 results match the dashboard filter, quarter = Q1.",
      ),
    );

    act(() => {
      store.dispatch(clearCrossFilter());
    });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Cross-filter cleared: 250 results."),
    );
  });

  it("a refresh (poll / SSE fan-out) on the desktop host keeps the eq and the filtered count", async () => {
    let fanout: (() => void) | undefined;
    mockUsePanelRunRefresh.mockImplementation((_id, cb) => {
      fanout = cb;
    });
    const { store } = renderCard();
    await settled(store, 50);
    getOutputRowsMock.mockClear();

    act(() => fanout?.());
    await waitFor(() => expect(getOutputRowsMock).toHaveBeenCalled());
    await settled(store, 50);

    expect(getOutputRowsMock.mock.calls.every((c) => hasEq(c[4]))).toBe(true);
    expect(entryOf(store).rows).toHaveLength(50);
  });

  it("a load-more page carries the same eq op as the filtered window", async () => {
    allRows = Array.from({ length: 600 }, (_, i) => ({
      quarter: i % 2 === 0 ? "Q1" : "Q2",
      idx: i,
    }));
    const { store } = renderCard();
    await settled(store, 300);
    expect(entryOf(store).hasMore).toBe(true);

    fireEvent.click(await screen.findByRole("button", { name: /load more/i }));
    await waitFor(() =>
      expect(getOutputRowsMock.mock.calls.some((c) => (c[1] ?? 0) > 0 && hasEq(c[4]))).toBe(true),
    );
    await waitFor(() => expect(entryOf(store).isLoadingMore).toBe(false));
    // Every appended row belongs to the filtered set.
    expect(entryOf(store).rows.every((r) => r.quarter === "Q1")).toBe(true);
    expect(entryOf(store).lastQuery?.crossFilterEq).toEqual({ column: "quarter", value: "Q1" });
  });

  describe("a 400 on the eq (cardinality grew past the cap) self-heals to the client fallback", () => {
    function rejectEq400(onlyPageZero: boolean) {
      getOutputRowsMock.mockImplementation((_id, offset = 0, limit = 50, _sort, filter) => {
        if (hasEq(filter) && (!onlyPageZero || offset === 0)) return Promise.reject(makeAxios400());
        return serve(offset, limit, filter);
      });
    }

    it("page-0 effect class: no toast, no error state, refetches without the eq and narrows client-side", async () => {
      rejectEq400(true);
      const { store } = renderCard();

      await settled(store, 250);
      expect(await screen.findByText("40 of 200 loaded rows match.")).toBeInTheDocument();
      expect(store.getState().toasts.items).toHaveLength(0);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      const eqCount = eqCalls().length;
      expect(eqCount).toBeGreaterThan(0);
      // Blocked for the TTL: it never retries the eq.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
      expect(eqCalls()).toHaveLength(eqCount);
    });

    it("mount/refresh replay class: an ops-less host replaying a recorded eq that is now rejected shows no error state", async () => {
      rejectEq400(true);
      const { store } = renderCard({
        paginationState: {
          "panel-sibling": {
            currentPage: 0,
            hasMore: false,
            isLoadingMore: false,
            rows: allRows.filter((r) => r.quarter === "Q1"),
            materialized: true,
            total: 50,
            lastQuery: {
              outputId: "output-1",
              crossFilterEq: { column: "quarter", value: "Q1" },
            },
          },
        },
      });

      await settled(store, 250);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(store.getState().toasts.items).toHaveLength(0);
    });

    it("load-more class: a rejected eq on an appended page raises no toast and flips to fallback", async () => {
      allRows = Array.from({ length: 600 }, (_, i) => ({
        quarter: i % 2 === 0 ? "Q1" : "Q2",
        idx: i,
      }));
      const { store } = renderCard();
      await settled(store, 300);
      rejectEq400(false);

      fireEvent.click(await screen.findByRole("button", { name: /load more/i }));
      // The thunk rejects with the eq code; the panel refetches WITHOUT the eq (unfiltered total).
      await settled(store, 600);
      expect(store.getState().toasts.items).toHaveLength(0);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  // HEL-1191 D2a (evaluation-1.md CR1/CR2) — the real backend rejects two ops with the same
  // (column, op) (`400 duplicate filter op`, OutputRowsQueryParsing.scala:76); this fake mirrors it,
  // so a same-column control + cross-filter can never be "AND-ed" server-side.
  describe("same-(column,op) control + cross-filter (D2a)", () => {
    const quarterControl: OutputControlSpec = {
      id: "c1",
      kind: "dropdown",
      column: "quarter",
      label: "Quarter",
    };
    const idxControl: OutputControlSpec = { id: "c2", kind: "text", column: "idx", label: "Idx" };
    let duplicateRejections = 0;

    beforeEach(() => {
      duplicateRejections = 0;
      getOutputRowsMock.mockImplementation((_id, offset = 0, limit = 50, _sort, filter) => {
        const seen = new Set<string>();
        for (const op of filter?.ops ?? []) {
          const key = `${op.column}|${op.op}`;
          if (seen.has(key)) {
            duplicateRejections += 1;
            return Promise.reject(makeAxios400());
          }
          seen.add(key);
        }
        return serve(offset, limit, filter);
      });
    });

    it("takes the client fallback with no 400, no cache invalidation, and an announcement matching the display", async () => {
      // Control quarter = Q2 (server-side) + cross quarter = Q1: the intersection is empty.
      const { store } = renderCard({
        controls: [quarterControl],
        path: "/?p.panel-sibling.c1=Q2",
      });

      await settled(store, 200);
      await waitFor(() => expect(getCapabilitiesEntry("output-1")?.status).toBe("ready"));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      expect(duplicateRejections).toBe(0);
      expect(getCapabilitiesEntry("output-1")?.status).toBe("ready");
      expect(eqCalls().every((c) => (c[4]?.ops ?? []).length === 1)).toBe(true);
      // Displayed: the control's server rows, client-narrowed by the cross-filter to nothing.
      expect(entryOf(store).rows.every((r) => r.quarter === "Q2")).toBe(true);
      expect(screen.getByRole("status")).toHaveTextContent("0 results.");
      expect(screen.getByRole("status")).not.toHaveTextContent("200 results");
    });

    it("the same control value as the cross-filter also falls back (intersection = that value)", async () => {
      const { store } = renderCard({
        controls: [quarterControl],
        path: "/?p.panel-sibling.c1=Q1",
      });

      await settled(store, 50);
      expect(duplicateRejections).toBe(0);
      expect(getCapabilitiesEntry("output-1")?.status).toBe("ready");
      expect(screen.getByRole("status")).toHaveTextContent("50 results.");
    });

    it("a control on a DIFFERENT column still composes with the cross eq on the server path", async () => {
      const { store } = renderCard({
        controls: [idxControl],
        path: "/?p.panel-sibling.c2=5",
      });

      await settled(store, 1);
      expect(duplicateRejections).toBe(0);
      const last = getOutputRowsMock.mock.calls[getOutputRowsMock.mock.calls.length - 1];
      expect(last[4]?.ops).toEqual(
        expect.arrayContaining([
          { column: "idx", op: "eq", value: "5" },
          { column: "quarter", op: "eq", value: "Q1" },
        ]),
      );
      expect(getCapabilitiesEntry("output-1")?.status).toBe("ready");
    });
  });
});
