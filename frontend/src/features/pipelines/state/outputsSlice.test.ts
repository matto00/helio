import { configureStore } from "@reduxjs/toolkit";

import { httpClient } from "../../../services/httpClient";
import {
  fetchAllOutputs,
  fetchOutputs,
  outputsReducer,
  previewOutput,
  resetRunScopedState,
  selectAllOutputs,
  selectAllOutputsStatus,
  selectOutputPreview,
  selectOutputsByStepId,
  selectOutputsForPipeline,
  selectOutputsForStep,
} from "./outputsSlice";
import type { Output, RunResult } from "../types/output";

jest.mock("../../../services/httpClient", () => ({
  httpClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const mockedHttpClient = jest.mocked(httpClient);

function buildStore() {
  return configureStore({ reducer: { outputs: outputsReducer } });
}

function runResult(rowCount: number): RunResult {
  return {
    rows: [],
    rowCount,
    stepRowCounts: {},
    sourceRowCount: rowCount,
    blocked: false,
    sourceTruncated: false,
    truncatedReads: [],
  };
}

describe("outputsSlice", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("normalizes an absent nodeStepId (spray-json omits None) rather than treating it as present", async () => {
    mockedHttpClient.get.mockResolvedValueOnce({
      data: {
        items: [
          {
            id: "out-1",
            pipelineId: "p-1",
            // nodeStepId intentionally absent -- root-level Output.
            ownerId: "u-1",
            name: "Revenue",
            kind: "metric",
            config: {},
            schema: [],
            createdAt: "2026-08-01T00:00:00Z",
            updatedAt: "2026-08-01T00:00:00Z",
          },
        ],
      },
    });
    const store = buildStore();
    await store.dispatch(fetchOutputs({ pipelineId: "p-1" }));

    // @ts-expect-error -- test store only wires the outputs slice
    const outputs = selectOutputsForPipeline(store.getState(), "p-1");
    expect(outputs[0].nodeStepId).toBeUndefined();
  });

  // Evaluation-1 cycle-2 CR5 (F-146 class regression): each of these selectors must return
  // the SAME array/object reference across two calls on unchanged state for a pipeline with
  // no Outputs yet -- a `?? []`/fresh-`.filter()` fallback allocates a new reference every
  // call, which defeats `useAppSelector`'s reference-equality check and cascades rerenders.
  it("selectOutputsForPipeline returns a stable reference across calls for an absent pipeline id", () => {
    const store = buildStore();
    // @ts-expect-error -- test store only wires the outputs slice
    const first = selectOutputsForPipeline(store.getState(), "no-such-pipeline");
    // @ts-expect-error -- test store only wires the outputs slice
    const second = selectOutputsForPipeline(store.getState(), "no-such-pipeline");
    expect(first).toBe(second);
  });

  it("selectOutputsForStep returns a stable reference across calls for an absent pipeline id", () => {
    const store = buildStore();
    // @ts-expect-error -- test store only wires the outputs slice
    const first = selectOutputsForStep(store.getState(), "no-such-pipeline", "step-1");
    // @ts-expect-error -- test store only wires the outputs slice
    const second = selectOutputsForStep(store.getState(), "no-such-pipeline", "step-1");
    expect(first).toBe(second);
  });

  it("selectOutputsByStepId returns a stable reference across calls for an absent pipeline id", () => {
    const store = buildStore();
    // @ts-expect-error -- test store only wires the outputs slice
    const first = selectOutputsByStepId(store.getState(), "no-such-pipeline");
    // @ts-expect-error -- test store only wires the outputs slice
    const second = selectOutputsByStepId(store.getState(), "no-such-pipeline");
    expect(first).toBe(second);
  });

  it("HEL-681: a slower, earlier preview response never overwrites a faster, later one", async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    const firstCall = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    mockedHttpClient.post
      .mockImplementationOnce(() => firstCall as Promise<{ data: unknown }>)
      .mockResolvedValueOnce({
        data: { outputs: [{ outputId: "out-1", preview: runResult(99) }] },
      });

    const store = buildStore();
    // @ts-expect-error -- test store only wires the outputs slice
    const firstDispatch = store.dispatch(previewOutput({ pipelineId: "p-1", outputId: "out-1" }));
    // @ts-expect-error -- test store only wires the outputs slice
    const secondDispatch = store.dispatch(previewOutput({ pipelineId: "p-1", outputId: "out-1" }));

    await secondDispatch;
    // @ts-expect-error -- test store only wires the outputs slice
    expect(selectOutputPreview(store.getState(), "out-1")?.rowCount).toBe(99);

    resolveFirst({ data: { outputs: [{ outputId: "out-1", preview: runResult(1) }] } });
    await firstDispatch;

    // @ts-expect-error -- test store only wires the outputs slice
    expect(selectOutputPreview(store.getState(), "out-1")?.rowCount).toBe(99);
  });

  it("resetRunScopedState (HEL-878) clears every preview cache field", () => {
    const store = buildStore();
    store.dispatch(resetRunScopedState());
    const state = store.getState().outputs;
    expect(state.previewByKey).toEqual({});
    expect(state.previewStatus).toEqual({});
    expect(state.previewRequestToken).toEqual({});
  });

  // HEL-503 evaluator CR1 (cycle 2) — task 2.1's own prescribed guard: "a test that a >1-page
  // response is fully indexed (mock `total` greater than one page and assert every item is
  // present)". WHAT THIS PROVES: `fetchAllOutputs` (via `listAllOutputs()`) loops until every
  // page is read, not just the first. WHAT IT CANNOT PROVE: the real backend's actual pagination
  // semantics (`Page.Default.limit`/`Page.MaxLimit`) — this mocks `httpClient.get` directly, so
  // it exercises the CLIENT's looping logic against an arbitrary two-page shape, not the real
  // endpoint's page-size contract.
  //
  // FAILABLE BY MUTATION, RUN AND CONFIRMED: temporarily hardcoding `listAllOutputs()`
  // (`outputService.ts`) to `return response.data.items` after the FIRST request (never looping)
  // turned this RED — `allItems` had only the first page's 200 items, not the full 250; restoring
  // the loop turned it back green. Both runs observed directly.
  it("fetchAllOutputs indexes every item across a >1-page response, not just the first page", async () => {
    function fakeOutput(id: string): Output {
      return {
        id,
        pipelineId: "p-1",
        ownerId: "u-1",
        name: `Output ${id}`,
        kind: "metric",
        config: {},
        schema: [],
        createdAt: "2026-08-01T00:00:00Z",
        updatedAt: "2026-08-01T00:00:00Z",
      };
    }
    const firstPage = Array.from({ length: 200 }, (_, i) => fakeOutput(`o${i}`));
    const secondPage = Array.from({ length: 50 }, (_, i) => fakeOutput(`o${200 + i}`));

    mockedHttpClient.get
      .mockResolvedValueOnce({ data: { items: firstPage, total: 250, offset: 0, limit: 200 } })
      .mockResolvedValueOnce({
        data: { items: secondPage, total: 250, offset: 200, limit: 200 },
      });

    const store = buildStore();
    await store.dispatch(fetchAllOutputs());

    // @ts-expect-error -- test store only wires the outputs slice
    const allItems = selectAllOutputs(store.getState());
    expect(allItems).toHaveLength(250);
    expect(allItems.map((o) => o.id)).toContain("o249");
    expect(mockedHttpClient.get).toHaveBeenCalledTimes(2);
    // @ts-expect-error -- test store only wires the outputs slice
    expect(selectAllOutputsStatus(store.getState())).toBe("succeeded");
  });

  it("fetchAllOutputs on a rejected request sets allStatus to failed", async () => {
    mockedHttpClient.get.mockRejectedValueOnce(new Error("network error"));
    const store = buildStore();
    await store.dispatch(fetchAllOutputs());
    // @ts-expect-error -- test store only wires the outputs slice
    expect(selectAllOutputsStatus(store.getState())).toBe("failed");
  });
});
