import { createAsyncThunk, createSelector, createSlice } from "@reduxjs/toolkit";

import { clearAuth } from "../../auth/state/authSlice";
import { extractErrorMessage } from "../../../services/extractErrorMessage";
import type { RootFrame, SourceFrames } from "../../pipelines/evaluator/evaluatePipeline";
import type { Frame } from "../../pipelines/evaluator/value";
import { decodeRow } from "../../pipelines/evaluator/wire";
import type { PipelineRoot } from "../../pipelines/types/pipelineStep";
import { fetchSourceSample as fetchSourceSampleRequest } from "../services/dataSourceService";
import type { SourceSample } from "../types/dataSource";

// HEL-1628 (owner ruling C, `client-memory`): the in-memory sample store behind the pipeline editor's draft
// preview. Nothing here is persisted -- no localStorage, no sessionStorage, no redux-persist -- so a page reload
// starts empty. A source is captured once when the editor opens with nothing cached; after that only an explicit
// refresh (`force`) re-fetches it. Never fetched per edit.

export interface SourceSampleEntry {
  status: "loading" | "ready" | "error";
  /** The last good sample: kept while a refresh is loading, and after a failed refresh. */
  sample?: SourceSample;
  error?: string;
  /** `Date.now()` when the latest request was sent. */
  requestedAt: number;
}

export interface SourceSamplesState {
  entries: Record<string, SourceSampleEntry>;
  /** Bumped on sign-out. A request sent in an earlier epoch is dropped when it settles, so a response that lands
   *  after sign-out can never repopulate the store with the previous user's rows. */
  epoch: number;
}

const initialState: SourceSamplesState = { entries: {}, epoch: 0 };

interface SamplesRootState {
  sourceSamples: SourceSamplesState;
}

export interface FetchSourceSampleArg {
  sourceId: string;
  /** Set only by the refresh control: re-fetch even though an entry exists. */
  force?: boolean;
  /** HEL-1648: the pipeline page the request is made from, so a source the caller does not own can be sampled
   *  through a pipeline that uses it. Never remembered per entry: each request names the CURRENT page's pipeline. */
  pipelineId?: string;
}

interface FetchFulfilled {
  sourceId: string;
  sample: SourceSample;
  epoch: number;
}

interface FetchRejected {
  sourceId: string;
  message: string;
  epoch: number;
}

export const fetchSourceSample = createAsyncThunk<
  FetchFulfilled,
  FetchSourceSampleArg,
  { state: SamplesRootState; rejectValue: FetchRejected }
>(
  "sourceSamples/fetch",
  async ({ sourceId, pipelineId }, { getState, rejectWithValue }) => {
    const epoch = getState().sourceSamples.epoch;
    try {
      return { sourceId, sample: await fetchSourceSampleRequest(sourceId, pipelineId), epoch };
    } catch (err) {
      return rejectWithValue({
        sourceId,
        message: extractErrorMessage(err, "Sample unavailable."),
        epoch,
      });
    }
  },
  {
    // One request at a time per source, and capture-once: an existing entry (ready OR failed) is not
    // re-fetched unless the refresh control forced it. A failed first capture is not retried automatically,
    // so a source that always fails cannot burn the 30/min source-fetch budget.
    condition: ({ sourceId, force }, { getState }) => {
      const entry = getState().sourceSamples.entries[sourceId];
      if (entry?.status === "loading") return false;
      return force === true || entry === undefined;
    },
  },
);

const sourceSamplesSlice = createSlice({
  name: "sourceSamples",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchSourceSample.pending, (state, action) => {
        const { sourceId } = action.meta.arg;
        state.entries[sourceId] = {
          status: "loading",
          sample: state.entries[sourceId]?.sample,
          requestedAt: Date.now(),
        };
      })
      .addCase(fetchSourceSample.fulfilled, (state, action) => {
        const { sourceId, sample, epoch } = action.payload;
        if (epoch !== state.epoch) return;
        state.entries[sourceId] = {
          status: "ready",
          sample,
          requestedAt: state.entries[sourceId]?.requestedAt ?? Date.now(),
        };
      })
      .addCase(fetchSourceSample.rejected, (state, action) => {
        if (action.meta.condition || action.payload === undefined) return;
        const { sourceId, message, epoch } = action.payload;
        if (epoch !== state.epoch) return;
        state.entries[sourceId] = {
          status: "error",
          sample: state.entries[sourceId]?.sample,
          error: message,
          requestedAt: state.entries[sourceId]?.requestedAt ?? Date.now(),
        };
      })
      .addCase(clearAuth, (state) => ({ entries: {}, epoch: state.epoch + 1 }));
  },
});

export const sourceSamplesReducer = sourceSamplesSlice.reducer;

// --- selectors (shaped for the HEL-1581 evaluator's inputs; HEL-1631 (e) wires them) -----------------------------

export const selectSourceSampleEntry = (
  state: SamplesRootState,
  sourceId: string,
): SourceSampleEntry | undefined => state.sourceSamples.entries[sourceId];

/** The latest good sample of a source (raw wire encoding), if one was captured. */
export const selectSourceSample = (
  state: SamplesRootState,
  sourceId: string,
): SourceSample | undefined => state.sourceSamples.entries[sourceId]?.sample;

const decoded = new WeakMap<SourceSample, Frame>();

/** Decodes a sample's rows into the evaluator's value model, once per sample object (so a frame keeps its
 *  identity until the sample is refreshed, which is what lets the evaluator reuse cached step results). */
export function sampleFrame(sample: SourceSample): Frame {
  let frame = decoded.get(sample);
  if (frame === undefined) {
    frame = sample.rows.map(decodeRow);
    decoded.set(sample, frame);
  }
  return frame;
}

/** The evaluator's `RootFrame[]` for a pipeline's roots: `rootId` is the pipeline root id, rows come from the
 *  sample of that root's `dataSourceId`. A root whose source has no sample yet is omitted. */
export const selectRootFrames = createSelector(
  [
    (state: SamplesRootState) => state.sourceSamples.entries,
    (_state: SamplesRootState, roots: readonly PipelineRoot[]) => roots,
  ],
  (entries, roots): RootFrame[] =>
    roots.flatMap((root) => {
      const sample = entries[root.dataSourceId]?.sample;
      return sample === undefined ? [] : [{ rootId: root.id, rows: sampleFrame(sample) }];
    }),
);

/** The evaluator's `SourceFrames` (keyed by source id, `complete` false for a truncated sample) for `ids`. A
 *  source without a sample is omitted. */
export const selectSourceFrames = createSelector(
  [
    (state: SamplesRootState) => state.sourceSamples.entries,
    (_state: SamplesRootState, ids: readonly string[]) => ids,
  ],
  (entries, ids): SourceFrames =>
    Object.fromEntries(
      ids.flatMap((id) => {
        const sample = entries[id]?.sample;
        return sample === undefined
          ? []
          : [[id, { rows: sampleFrame(sample), complete: !sample.truncated }] as const];
      }),
    ),
);
