import {
  createAsyncThunk,
  createSelector,
  createSlice,
  type PayloadAction,
} from "@reduxjs/toolkit";
import { isAxiosError } from "axios";

import type { RootState } from "../../../store/store";
import {
  createOutput as createOutputRequest,
  deleteOutput as deleteOutputRequest,
  getNodeCapabilities,
  listOutputs,
  previewOutputs as previewOutputsRequest,
  previewStep as previewStepRequest,
  updateOutput as updateOutputRequest,
} from "../services/outputService";
// HEL-878 (task 2.4): `submitPipelineRun` lives in `pipelinesSlice`, not here --
// imported ONLY so this slice's `extraReducers` can react to its `.pending`
// action and reset the preview cache the instant a new run starts, without
// requiring every dispatch call site to remember a second dispatch. One-way
// dependency (pipelinesSlice does not import outputsSlice), so no cycle.
import { submitPipelineRun } from "./pipelinesSlice";
import type {
  CreateOutputPayload,
  NodeCapabilities,
  Output,
  PipelinePreviewResult,
  RunResult,
  UpdateOutputPayload,
} from "../types/output";

/** Matches `pipelinesSlice.ts`'s existing error-extraction pattern (design D4):
 *  the backend's `ErrorResponse(message)` always uses the `message` field name. */
function extractErrorMessage(err: unknown, fallback: string): string {
  if (isAxiosError(err) && typeof err.response?.data?.message === "string") {
    return err.response.data.message;
  }
  return fallback;
}

type AsyncStatus = "idle" | "loading" | "succeeded" | "failed";

/** Capabilities cache is keyed by `${pipelineId}:${stepId ?? "root"}` — one
 *  entry per node, shared by every Output sheet/rail chip open against that
 *  node. */
function capabilitiesCacheKey(pipelineId: string, stepId?: string): string {
  return `${pipelineId}:${stepId ?? "root"}`;
}

interface OutputsState {
  byPipeline: Record<string, Output[]>;
  listStatus: Record<string, AsyncStatus>;
  listError: Record<string, string | null>;

  capabilities: Record<string, NodeCapabilities>;
  capabilitiesStatus: Record<string, AsyncStatus>;

  /** Preview cache keyed by `outputId` for saved Outputs, or `step:<stepId>`
   *  for an unsaved Output previewing its target step (design.md decision
   *  5/6a). Shared by rail thumbnails and the Output sheet via
   *  `usePipelinePreviewCache`. */
  previewByKey: Record<string, RunResult>;
  previewStatus: Record<string, AsyncStatus>;
  previewError: Record<string, string | null>;

  /** Monotonically increasing token per preview key — a stale in-flight
   *  request's `.then` compares its captured token against the latest before
   *  writing the cache, so an out-of-order response never clobbers a newer
   *  one (HEL-681). */
  previewRequestToken: Record<string, number>;

  saveStatus: AsyncStatus;
  saveError: string | null;
}

const initialState: OutputsState = {
  byPipeline: {},
  listStatus: {},
  listError: {},
  capabilities: {},
  capabilitiesStatus: {},
  previewByKey: {},
  previewStatus: {},
  previewError: {},
  previewRequestToken: {},
  saveStatus: "idle",
  saveError: null,
};

export const fetchOutputs = createAsyncThunk<
  { pipelineId: string; outputs: Output[] },
  { pipelineId: string; nodeStepId?: string },
  { rejectValue: string }
>("outputs/fetchOutputs", async ({ pipelineId, nodeStepId }, { rejectWithValue }) => {
  try {
    const outputs = await listOutputs(pipelineId, nodeStepId);
    return { pipelineId, outputs };
  } catch (err) {
    return rejectWithValue(extractErrorMessage(err, "Failed to load outputs."));
  }
});

export const createOutput = createAsyncThunk<
  Output,
  { pipelineId: string; payload: CreateOutputPayload },
  { rejectValue: string }
>("outputs/createOutput", async ({ pipelineId, payload }, { rejectWithValue }) => {
  try {
    return await createOutputRequest(pipelineId, payload);
  } catch (err) {
    return rejectWithValue(extractErrorMessage(err, "Failed to create output."));
  }
});

export const updateOutput = createAsyncThunk<
  Output,
  { outputId: string; payload: UpdateOutputPayload },
  { rejectValue: string }
>("outputs/updateOutput", async ({ outputId, payload }, { rejectWithValue }) => {
  try {
    return await updateOutputRequest(outputId, payload);
  } catch (err) {
    return rejectWithValue(extractErrorMessage(err, "Failed to update output."));
  }
});

export const deleteOutput = createAsyncThunk<
  { outputId: string; pipelineId: string },
  { outputId: string; pipelineId: string },
  { rejectValue: string }
>("outputs/deleteOutput", async ({ outputId, pipelineId }, { rejectWithValue }) => {
  try {
    await deleteOutputRequest(outputId);
    return { outputId, pipelineId };
  } catch (err) {
    return rejectWithValue(extractErrorMessage(err, "Failed to delete output."));
  }
});

export const fetchNodeCapabilities = createAsyncThunk<
  { key: string; capabilities: NodeCapabilities },
  { pipelineId: string; stepId?: string },
  { rejectValue: string }
>("outputs/fetchNodeCapabilities", async ({ pipelineId, stepId }, { rejectWithValue }) => {
  try {
    const capabilities = await getNodeCapabilities(pipelineId, stepId);
    return { key: capabilitiesCacheKey(pipelineId, stepId), capabilities };
  } catch (err) {
    return rejectWithValue(extractErrorMessage(err, "Failed to load capabilities."));
  }
});

/** HEL-681 fix: each dispatch bumps `previewRequestToken[key]`; the
 *  `fulfilled` reducer only writes the cache if its own token is still the
 *  latest for that key, so an earlier, slower request landing after a
 *  faster newer one can never overwrite fresher data. */
export const previewOutput = createAsyncThunk<
  { key: string; result: RunResult; requestToken: number },
  { pipelineId: string; outputId: string },
  { state: RootState; rejectValue: string }
>(
  "outputs/previewOutput",
  async ({ pipelineId, outputId }, { getState, dispatch, rejectWithValue }) => {
    const key = outputId;
    const requestToken = (getState().outputs.previewRequestToken[key] ?? 0) + 1;
    dispatch(outputsSlice.actions.bumpPreviewToken({ key, token: requestToken }));
    try {
      const response: PipelinePreviewResult = await previewOutputsRequest(pipelineId, outputId);
      const entry = response.outputs.find((o) => o.outputId === outputId);
      if (entry === undefined) {
        return rejectWithValue("Preview response did not include the requested output.");
      }
      return { key, result: entry.preview, requestToken };
    } catch (err) {
      return rejectWithValue(extractErrorMessage(err, "Failed to preview output."));
    }
  },
);

export const previewUnsavedOutputStep = createAsyncThunk<
  { key: string; result: RunResult; requestToken: number },
  { pipelineId: string; stepId: string },
  { state: RootState; rejectValue: string }
>(
  "outputs/previewUnsavedOutputStep",
  async ({ pipelineId, stepId }, { getState, dispatch, rejectWithValue }) => {
    const key = `step:${stepId}`;
    const requestToken = (getState().outputs.previewRequestToken[key] ?? 0) + 1;
    dispatch(outputsSlice.actions.bumpPreviewToken({ key, token: requestToken }));
    try {
      const result = await previewStepRequest(pipelineId, stepId);
      return { key, result, requestToken };
    } catch (err) {
      return rejectWithValue(extractErrorMessage(err, "Failed to preview step."));
    }
  },
);

const outputsSlice = createSlice({
  name: "outputs",
  initialState,
  reducers: {
    bumpPreviewToken(state, action: PayloadAction<{ key: string; token: number }>) {
      state.previewRequestToken[action.payload.key] = action.payload.token;
      state.previewStatus[action.payload.key] = "loading";
    },
    /** HEL-878: every piece of run-scoped Output state (rail/sheet preview
     *  caches, save status) resets through this single reducer, called from
     *  both the run-thunk lifecycle and the SSE run-complete handler, so a
     *  new run/navigation never leaves a stale thumbnail visible under a
     *  "Snapshot replaced" chip that never actually updates. */
    resetRunScopedState(state) {
      state.previewByKey = {};
      state.previewStatus = {};
      state.previewError = {};
      state.previewRequestToken = {};
    },
  },
  extraReducers: (builder) => {
    builder
      // HEL-878 (task 2.4): a new dry/live run invalidates every rail-chip and
      // Output-sheet preview immediately, before the new run completes -- this
      // is the thunk-lifecycle half of the single-reset-path unification (the
      // other half is the SSE terminal handler in `usePipelineDetailPage.ts`).
      .addCase(submitPipelineRun.pending, (state) => {
        state.previewByKey = {};
        state.previewStatus = {};
        state.previewError = {};
        state.previewRequestToken = {};
      })
      .addCase(fetchOutputs.pending, (state, action) => {
        state.listStatus[action.meta.arg.pipelineId] = "loading";
        state.listError[action.meta.arg.pipelineId] = null;
      })
      .addCase(fetchOutputs.fulfilled, (state, action) => {
        state.byPipeline[action.payload.pipelineId] = action.payload.outputs;
        state.listStatus[action.payload.pipelineId] = "succeeded";
      })
      .addCase(fetchOutputs.rejected, (state, action) => {
        state.listStatus[action.meta.arg.pipelineId] = "failed";
        state.listError[action.meta.arg.pipelineId] = action.payload ?? "Failed to load outputs.";
      })
      .addCase(createOutput.pending, (state) => {
        state.saveStatus = "loading";
        state.saveError = null;
      })
      .addCase(createOutput.fulfilled, (state, action) => {
        state.saveStatus = "succeeded";
        const existing = state.byPipeline[action.payload.pipelineId] ?? [];
        state.byPipeline[action.payload.pipelineId] = [...existing, action.payload];
      })
      .addCase(createOutput.rejected, (state, action) => {
        state.saveStatus = "failed";
        state.saveError = action.payload ?? "Failed to create output.";
      })
      .addCase(updateOutput.fulfilled, (state, action) => {
        const list = state.byPipeline[action.payload.pipelineId];
        if (list !== undefined) {
          state.byPipeline[action.payload.pipelineId] = list.map((o) =>
            o.id === action.payload.id ? action.payload : o,
          );
        }
      })
      .addCase(deleteOutput.fulfilled, (state, action) => {
        const list = state.byPipeline[action.payload.pipelineId];
        if (list !== undefined) {
          state.byPipeline[action.payload.pipelineId] = list.filter(
            (o) => o.id !== action.payload.outputId,
          );
        }
      })
      .addCase(fetchNodeCapabilities.pending, (state, action) => {
        state.capabilitiesStatus[
          capabilitiesCacheKey(action.meta.arg.pipelineId, action.meta.arg.stepId)
        ] = "loading";
      })
      .addCase(fetchNodeCapabilities.fulfilled, (state, action) => {
        state.capabilities[action.payload.key] = action.payload.capabilities;
        state.capabilitiesStatus[action.payload.key] = "succeeded";
      })
      .addCase(fetchNodeCapabilities.rejected, (state, action) => {
        state.capabilitiesStatus[
          capabilitiesCacheKey(action.meta.arg.pipelineId, action.meta.arg.stepId)
        ] = "failed";
      })
      .addCase(previewOutput.fulfilled, (state, action) => {
        if (state.previewRequestToken[action.payload.key] !== action.payload.requestToken) {
          return;
        }
        state.previewByKey[action.payload.key] = action.payload.result;
        state.previewStatus[action.payload.key] = "succeeded";
      })
      .addCase(previewOutput.rejected, (state, action) => {
        const key = action.meta.arg.outputId;
        state.previewStatus[key] = "failed";
        state.previewError[key] = action.payload ?? "Failed to preview output.";
      })
      .addCase(previewUnsavedOutputStep.fulfilled, (state, action) => {
        if (state.previewRequestToken[action.payload.key] !== action.payload.requestToken) {
          return;
        }
        state.previewByKey[action.payload.key] = action.payload.result;
        state.previewStatus[action.payload.key] = "succeeded";
      })
      .addCase(previewUnsavedOutputStep.rejected, (state, action) => {
        const key = `step:${action.meta.arg.stepId}`;
        state.previewStatus[key] = "failed";
        state.previewError[key] = action.payload ?? "Failed to preview step.";
      });
  },
});

export const { resetRunScopedState } = outputsSlice.actions;
export type { OutputsState };
export const outputsReducer = outputsSlice.reducer;

// Evaluation-1 cycle-2 CR5 (F-146 class regression): a shared, module-level empty-array
// sentinel so selectors reading an absent `byPipeline[pipelineId]` entry return the SAME
// array reference on every call, instead of allocating a fresh `[]` via `?? []` each time.
// `useAppSelector` (React-Redux) compares selector results by reference; a fresh array every
// call breaks that comparison and defeats memoization for every downstream consumer, cascading
// rerenders that grow with every interaction.
const EMPTY_OUTPUTS: readonly Output[] = [];

export const selectOutputsForPipeline = (state: RootState, pipelineId: string): Output[] =>
  state.outputs.byPipeline[pipelineId] ?? (EMPTY_OUTPUTS as Output[]);

export const selectOutputsForStep = createSelector(
  [
    (state: RootState, pipelineId: string) => state.outputs.byPipeline[pipelineId] ?? EMPTY_OUTPUTS,
    (_state: RootState, _pipelineId: string, stepId: string) => stepId,
  ],
  (outputs: readonly Output[], stepId: string): Output[] =>
    outputs.filter((o) => o.nodeStepId === stepId),
);

export const selectNodeCapabilities = (
  state: RootState,
  pipelineId: string,
  stepId?: string,
): NodeCapabilities | undefined =>
  state.outputs.capabilities[capabilitiesCacheKey(pipelineId, stepId)];

export const selectOutputPreview = (state: RootState, outputId: string): RunResult | undefined =>
  state.outputs.previewByKey[outputId];

export const selectUnsavedStepPreview = (state: RootState, stepId: string): RunResult | undefined =>
  state.outputs.previewByKey[`step:${stepId}`];

/** Groups a pipeline's Outputs by `nodeStepId` (task 3.3) -- one array per
 *  trunk/tail step, feeding `OutputsRail`. Outputs bound to the pipeline root
 *  (`nodeStepId` absent -- see the wire-shape note atop `types/output.ts`)
 *  are deliberately excluded: there is no `StepCard` for the root node to
 *  render a rail under. `createSelector`'s input-equality check is on the
 *  INPUT selector's return value, not merely `byPipeline[pipelineId]`'s own
 *  identity -- the correction from evaluation-1 cycle-2 CR5: the previous
 *  wording here claimed memoization on that identity alone, but the input
 *  selector's own `?? []` fallback allocated a fresh empty array on every
 *  call whenever the pipeline had no Outputs yet, so the equality check
 *  never held and this recomputed (and allocated a fresh `{}`) every call.
 *  Fixed via the shared `EMPTY_OUTPUTS` sentinel above, which gives the
 *  fallback a stable reference so `createSelector`'s memoization actually
 *  holds once a pipeline's Outputs stop changing. */
export const selectOutputsByStepId = createSelector(
  [(state: RootState, pipelineId: string) => state.outputs.byPipeline[pipelineId] ?? EMPTY_OUTPUTS],
  (outputs: readonly Output[]): Record<string, Output[]> => {
    const byStepId: Record<string, Output[]> = {};
    for (const output of outputs) {
      if (output.nodeStepId === undefined) continue;
      (byStepId[output.nodeStepId] ??= []).push(output);
    }
    return byStepId;
  },
);

/** Derives `{outputId: rowCount}` from the shared preview cache (task 3.3) --
 *  the rail's live-thumbnail data source, per design.md decision 2's
 *  "rail and sheet share one preview-cache hook" contract. Only keys NOT
 *  prefixed `step:` (the unsaved-step-preview convention, decision 6a) count
 *  as saved-Output previews. */
export const selectPreviewRowCountByOutputId = createSelector(
  [(state: RootState) => state.outputs.previewByKey],
  (previewByKey: Record<string, RunResult>): Record<string, number> => {
    const byOutputId: Record<string, number> = {};
    for (const [key, result] of Object.entries(previewByKey)) {
      if (key.startsWith("step:")) continue;
      byOutputId[key] = result.rowCount;
    }
    return byOutputId;
  },
);
