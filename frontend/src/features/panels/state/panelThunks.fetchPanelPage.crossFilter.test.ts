import { configureStore } from "@reduxjs/toolkit";
import { AxiosError, type AxiosResponse } from "axios";

import type { AppDispatch } from "../../../store/store";
import * as outputService from "../../pipelines/services/outputService";
import {
  ensureCapabilitiesLoaded,
  getCapabilitiesEntry,
  resetCapabilitiesStoreForTests,
} from "./filterCapabilitiesStore";
import { CROSS_FILTER_EQ_REJECTED } from "./panelThunks";
import { fetchPanelPage, panelsReducer } from "./panelsSlice";

// HEL-1191 design.md D1/D3a/D9a-i — the thunk is the single point where the cross-filter `eq`
// folds into `filter.ops` (via `composeOutputRowsFilter`), and the single 400-detection point.

jest.mock("../../pipelines/services/outputService", () => ({
  ...jest.requireActual("../../pipelines/services/outputService"),
  getOutputRows: jest.fn(),
  getFilterCapabilities: jest.fn(),
}));

const getOutputRows = jest.mocked(outputService.getOutputRows);
const getFilterCapabilities = jest.mocked(outputService.getFilterCapabilities);

function makeStore(): { dispatch: AppDispatch } {
  return configureStore({ reducer: { panels: panelsReducer } }) as unknown as {
    dispatch: AppDispatch;
  };
}

function axiosError(status: number): AxiosError {
  return new AxiosError("err", "ERR", undefined, undefined, {
    status,
    data: {},
  } as AxiosResponse);
}

const base = { panelId: "p1", outputId: "out-1", page: 0, pageSize: 200 };
const EQ = { column: "quarter", value: "Q1" };

async function primeCapabilities(): Promise<void> {
  getFilterCapabilities.mockResolvedValue({ columns: [{ column: "quarter", operators: ["eq"] }] });
  ensureCapabilitiesLoaded("out-1");
  await new Promise((r) => setTimeout(r, 0));
  expect(getCapabilitiesEntry("out-1")?.status).toBe("ready");
}

beforeEach(() => {
  jest.clearAllMocks();
  resetCapabilitiesStoreForTests();
  getOutputRows.mockResolvedValue({
    items: [],
    total: 0,
    offset: 0,
    limit: 200,
    materialized: true,
  });
});

describe("fetchPanelPage — crossFilterEq folding", () => {
  it("appends the eq to filter.ops through the composer, after the control ops", async () => {
    await makeStore().dispatch(
      fetchPanelPage({
        ...base,
        filter: { quick: "x", ops: [{ column: "region", op: "eq", value: "west" }] },
        crossFilterEq: EQ,
      }),
    );

    expect(getOutputRows).toHaveBeenCalledWith("out-1", 0, 200, undefined, {
      quick: "x",
      ops: [
        { column: "region", op: "eq", value: "west" },
        { column: "quarter", op: "eq", value: "Q1" },
      ],
    });
  });

  it("same-column control and cross-filter BOTH apply (AND, no override)", async () => {
    await makeStore().dispatch(
      fetchPanelPage({
        ...base,
        filter: { ops: [{ column: "quarter", op: "eq", value: "Q2" }] },
        crossFilterEq: EQ,
      }),
    );

    expect(getOutputRows.mock.calls[0][4]?.ops).toEqual([
      { column: "quarter", op: "eq", value: "Q2" },
      { column: "quarter", op: "eq", value: "Q1" },
    ]);
  });

  it("sends no filter when neither a control nor an eq is present", async () => {
    await makeStore().dispatch(fetchPanelPage(base));
    expect(getOutputRows.mock.calls[0][4]).toBeUndefined();
  });
});

describe("fetchPanelPage — 400 detection (D3a)", () => {
  it("a 400 on a request carrying crossFilterEq rejects with the distinguishable code and invalidates the capabilities entry", async () => {
    await primeCapabilities();
    getOutputRows.mockRejectedValue(axiosError(400));

    const result = await makeStore().dispatch(fetchPanelPage({ ...base, crossFilterEq: EQ }));

    expect(result.type).toBe("panels/fetchPanelPage/rejected");
    expect((result as { payload?: { code?: string } }).payload?.code).toBe(
      CROSS_FILTER_EQ_REJECTED,
    );
    expect(getCapabilitiesEntry("out-1")?.status).toBe("unavailable");
  });

  it("a 400 WITHOUT crossFilterEq (e.g. a same-column control eq) is not misread as a cap rejection", async () => {
    await primeCapabilities();
    getOutputRows.mockRejectedValue(axiosError(400));

    const result = await makeStore().dispatch(
      fetchPanelPage({
        ...base,
        filter: { ops: [{ column: "quarter", op: "eq", value: "Q2" }] },
      }),
    );

    expect((result as { payload?: { code?: string } }).payload?.code).toBeUndefined();
    expect(getCapabilitiesEntry("out-1")?.status).toBe("ready");
  });

  it("a non-400 failure carrying crossFilterEq is an ordinary failure (no code, no invalidation)", async () => {
    await primeCapabilities();
    getOutputRows.mockRejectedValue(axiosError(500));

    const result = await makeStore().dispatch(fetchPanelPage({ ...base, crossFilterEq: EQ }));

    expect((result as { payload?: { code?: string } }).payload?.code).toBeUndefined();
    expect(getCapabilitiesEntry("out-1")?.status).toBe("ready");
  });
});

describe("fetchPanelPage — lastQuery lifecycle (D9a-i)", () => {
  it("page-0 pending records {outputId, sort, filter, crossFilterEq}; the eq stays out of filter", () => {
    const state = panelsReducer(
      undefined,
      fetchPanelPage.pending("r1", {
        ...base,
        sort: { column: "idx", direction: "asc" },
        filter: { quick: "x" },
        crossFilterEq: EQ,
      }),
    );

    expect(state.paginationState.p1.lastQuery).toEqual({
      outputId: "out-1",
      sort: { column: "idx", direction: "asc" },
      filter: { quick: "x" },
      crossFilterEq: EQ,
    });
  });

  it("a load-more (page > 0) pending does NOT overwrite lastQuery", () => {
    const afterPage0 = panelsReducer(
      undefined,
      fetchPanelPage.pending("r1", { ...base, crossFilterEq: EQ }),
    );
    const afterMore = panelsReducer(
      afterPage0,
      fetchPanelPage.pending("r2", { ...base, page: 1, pageSize: 50 }),
    );

    expect(afterMore.paginationState.p1.lastQuery).toEqual({
      outputId: "out-1",
      crossFilterEq: EQ,
    });
  });

  it("fulfilled and rejected carry lastQuery forward", () => {
    const arg = { ...base, crossFilterEq: EQ };
    const pending = panelsReducer(undefined, fetchPanelPage.pending("r1", arg));
    const fulfilled = panelsReducer(
      pending,
      fetchPanelPage.fulfilled(
        { panelId: "p1", page: 0, rows: [], hasMore: false, materialized: true, total: 0 },
        "r1",
        arg,
      ),
    );
    expect(fulfilled.paginationState.p1.lastQuery?.crossFilterEq).toEqual(EQ);

    const rejected = panelsReducer(
      panelsReducer(undefined, fetchPanelPage.pending("r2", arg)),
      fetchPanelPage.rejected(null, "r2", arg, { message: "x", kind: "error" }),
    );
    expect(rejected.paginationState.p1.lastQuery?.crossFilterEq).toEqual(EQ);
  });
});
