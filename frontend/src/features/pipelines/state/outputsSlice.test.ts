import { configureStore } from "@reduxjs/toolkit";

import { httpClient } from "../../../services/httpClient";
import {
  fetchOutputs,
  outputsReducer,
  previewOutput,
  resetRunScopedState,
  selectOutputPreview,
  selectOutputsByStepId,
  selectOutputsForPipeline,
  selectOutputsForStep,
} from "./outputsSlice";
import type { RunResult } from "../types/output";

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
});
