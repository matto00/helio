// Per-panel CRUD thunks for the HEL-909 `{ type, config }` wire shape.
//
// Extracted from `panelsSlice.ts` so the slice file stays under the
// file-size cap. The slice imports these thunks for `extraReducers` wiring;
// the thunks call back into the slice's action creators (e.g.
// `markDashboardPanelsStale`) via a small `panelsActions` re-export to
// avoid a literal cyclic import on the slice's `reducer` symbol.

import { createAsyncThunk } from "@reduxjs/toolkit";

import {
  createPanel as createPanelRequest,
  deletePanel as deletePanelRequest,
  duplicatePanel as duplicatePanelRequest,
  fetchPanels as fetchPanelsRequest,
  patchPanelOutputId as patchPanelOutputIdRequest,
  updatePanelAppearance as updatePanelAppearanceRequest,
  updatePanelDivider as updatePanelDividerRequest,
  updatePanelForm as updatePanelFormRequest,
  updatePanelImage as updatePanelImageRequest,
  updatePanelMarkdownContent as updatePanelMarkdownContentRequest,
  updatePanelOutputControls as updatePanelOutputControlsRequest,
  updatePanelsBatch as updatePanelsBatchRequest,
  updatePanelTextContent as updatePanelTextContentRequest,
  updatePanelTitle as updatePanelTitleRequest,
} from "../services/panelService";
import { isAxiosError } from "axios";

import { currentGeneration } from "./outputFreshness";
import { getOutputMetaCached } from "./outputMetaCache";
import { applyPanelReadScopes } from "./applyPanelReadScopes";
import { clearRestoreMarkersExcept } from "./restoreMarkers";
import { fetchPublicPanelRows } from "../../dashboards/services/publicDashboardService";
import { isKnownNonOwnedDashboard } from "../../dashboards/state/dashboardAccess";
import { panelReadScopeFor } from "./panelReadScope";
import { panelControlColumns } from "./panelControlColumns";
import { splitForPanelScope } from "./splitForPanelScope";

import { serverNowMs } from "../../dashboards/tabs/serverClock";

import {
  composeOutputRowsFilter,
  getOutputRows,
  type FilteredMetric,
  type OutputRowsFilter,
  type OutputRowsSort,
} from "../../pipelines/services/outputService";
import {
  classifyRequestError,
  type RequestErrorKind,
} from "../../../services/classifyRequestError";
import type { RootState } from "../../../store/store";
import { invalidateCapabilities, panelCapabilitiesKey } from "./filterCapabilitiesStore";
import type {
  CrossFilterEq,
  DividerOrientation,
  FormPanelConfig,
  ImageFit,
  OutputControlSpec,
  Panel,
  PanelAppearance,
  PanelConfig,
  PanelKind,
  UpdatePanelsBatchRequest,
  UpdatePanelsBatchResponse,
} from "../types/panel";

// Imported as a delayed reference to avoid cyclic-import issues on the
// slice's `reducer` symbol. The thunks only need the action creator
// `markDashboardPanelsStale` and the `fetchPanels` thunk itself — both are
// re-exported by the slice once it is constructed.
import { markDashboardPanelsStale } from "./panelActions";
import { adoptPlacedLayouts } from "./panelPlacement";
import { getSessionEpoch } from "../../../shared/session/sessionEpoch";

export const fetchPanels = createAsyncThunk<
  Panel[],
  string,
  { state: RootState; rejectValue: string }
>(
  "panels/fetchPanels",
  async (dashboardId, { rejectWithValue, getState }) => {
    try {
      const panels = await fetchPanelsRequest(dashboardId);
      // HEL-1773: decide, before any card mounts, how this dashboard's Outputs are read (see `outputMetaCache`).
      const nonOwned = isKnownNonOwnedDashboard(getState(), dashboardId);
      applyPanelReadScopes(panels, dashboardId, nonOwned);
      // HEL-1783 D3b: a restore marker never outlives its restore -- fetching another dashboard's panels ends it.
      clearRestoreMarkersExcept(dashboardId);
      return panels;
    } catch {
      return rejectWithValue("Failed to load panels.");
    }
  },
  {
    condition: (dashboardId, { getState }) => {
      const { panels } = getState();
      if (panels.status === "loading" && panels.loadedDashboardId === dashboardId) {
        return false;
      }
      if (panels.status === "succeeded" && panels.loadedDashboardId === dashboardId) {
        return false;
      }
      return true;
    },
  },
);

export const createPanel = createAsyncThunk<
  Panel,
  {
    dashboardId: string;
    type: PanelKind;
    title?: string;
    outputId?: string;
    config?: PanelConfig;
  },
  { state: RootState; rejectValue: string }
>(
  "panels/createPanel",
  async (
    { dashboardId, type, title, outputId, config },
    { dispatch, getState, rejectWithValue },
  ) => {
    try {
      const startEpoch = getSessionEpoch();
      const createdPanel = await createPanelRequest(dashboardId, type, title, outputId, config);
      // HEL-1634: nothing below may touch the next user's state after a sign-out.
      if (startEpoch !== getSessionEpoch()) return createdPanel;
      // The server computes the placement (every kind, HEL-1260) and returns the item it stored in each
      // breakpoint; adopt those verbatim (see `panelPlacement.ts`).
      adoptPlacedLayouts(dispatch, getState, dashboardId, createdPanel);
      dispatch(markDashboardPanelsStale(dashboardId));
      await dispatch(fetchPanels(dashboardId));
      return createdPanel;
    } catch {
      return rejectWithValue("Failed to create panel.");
    }
  },
);

export const updatePanelTitle = createAsyncThunk<
  Panel,
  { panelId: string; title: string },
  { rejectValue: string }
>("panels/updatePanelTitle", async ({ panelId, title }, { rejectWithValue }) => {
  try {
    return await updatePanelTitleRequest(panelId, title);
  } catch {
    return rejectWithValue("Failed to update panel title.");
  }
});

/** "Swap output" (HEL-909 CR4) — PATCHes an existing panel's own `outputId`
 *  in place, preserving its position/size, then refetches the dashboard's
 *  panels so the sheet/grid reflect the new binding. `markDashboardPanelsStale`
 *  resets `panels.status` to `"idle"` first so `fetchPanels`'s own dedup
 *  `condition` doesn't skip the refetch (the dashboard is otherwise always
 *  already `"succeeded"` by the time a user reaches Swap output). */
export const swapPanelOutput = createAsyncThunk<
  Panel,
  { panelId: string; outputId: string; dashboardId: string },
  { state: RootState; rejectValue: string }
>(
  "panels/swapPanelOutput",
  async ({ panelId, outputId, dashboardId }, { dispatch, rejectWithValue }) => {
    try {
      const startEpoch = getSessionEpoch();
      const updated = await patchPanelOutputIdRequest(panelId, outputId);
      if (startEpoch !== getSessionEpoch()) return updated;
      dispatch(markDashboardPanelsStale(dashboardId));
      await dispatch(fetchPanels(dashboardId));
      return updated;
    } catch {
      return rejectWithValue("Failed to swap output.");
    }
  },
);

export const deletePanel = createAsyncThunk<
  string,
  { panelId: string; dashboardId: string },
  { rejectValue: string }
>("panels/deletePanel", async ({ panelId, dashboardId }, { dispatch, rejectWithValue }) => {
  try {
    const startEpoch = getSessionEpoch();
    await deletePanelRequest(panelId);
    if (startEpoch !== getSessionEpoch()) return panelId;
    dispatch(markDashboardPanelsStale(dashboardId));
    return panelId;
  } catch {
    return rejectWithValue("Failed to delete panel.");
  }
});

export const duplicatePanel = createAsyncThunk<
  Panel,
  { panelId: string; dashboardId: string },
  { state: RootState; rejectValue: string }
>(
  "panels/duplicatePanel",
  async ({ panelId, dashboardId }, { dispatch, getState, rejectWithValue }) => {
    try {
      const startEpoch = getSessionEpoch();
      const created = await duplicatePanelRequest(panelId);
      if (startEpoch !== getSessionEpoch()) return created;
      adoptPlacedLayouts(dispatch, getState, dashboardId, created);
      dispatch(markDashboardPanelsStale(dashboardId));
      await dispatch(fetchPanels(dashboardId));
      return created;
    } catch {
      return rejectWithValue("Failed to duplicate panel.");
    }
  },
);

export const updatePanelAppearance = createAsyncThunk<
  Panel,
  { panelId: string; appearance: PanelAppearance },
  { rejectValue: string }
>("panels/updatePanelAppearance", async ({ panelId, appearance }, { rejectWithValue }) => {
  try {
    return await updatePanelAppearanceRequest(panelId, appearance);
  } catch {
    return rejectWithValue("Failed to update panel appearance.");
  }
});

/** PATCH a Text panel's literal content. */
export const updatePanelTextContent = createAsyncThunk<
  Panel,
  { panelId: string; content: string },
  { rejectValue: string }
>("panels/updatePanelTextContent", async ({ panelId, content }, { rejectWithValue }) => {
  try {
    return await updatePanelTextContentRequest(panelId, content);
  } catch {
    return rejectWithValue("Failed to update panel content.");
  }
});

/** PATCH a Markdown panel's literal content. */
export const updatePanelMarkdownContent = createAsyncThunk<
  Panel,
  { panelId: string; content: string },
  { rejectValue: string }
>("panels/updatePanelMarkdownContent", async ({ panelId, content }, { rejectWithValue }) => {
  try {
    return await updatePanelMarkdownContentRequest(panelId, content);
  } catch {
    return rejectWithValue("Failed to update panel content.");
  }
});

export const updatePanelImage = createAsyncThunk<
  Panel,
  { panelId: string; imageUrl: string; imageFit: ImageFit; caption: string | null },
  { rejectValue: string }
>(
  "panels/updatePanelImage",
  async ({ panelId, imageUrl, imageFit, caption }, { rejectWithValue }) => {
    try {
      return await updatePanelImageRequest(panelId, imageUrl, imageFit, caption);
    } catch {
      return rejectWithValue("Failed to update panel image.");
    }
  },
);

export const updatePanelDivider = createAsyncThunk<
  Panel,
  {
    panelId: string;
    dividerOrientation: DividerOrientation;
    dividerWeight: number;
    dividerColor: string | null;
  },
  { rejectValue: string }
>(
  "panels/updatePanelDivider",
  async ({ panelId, dividerOrientation, dividerWeight, dividerColor }, { rejectWithValue }) => {
    try {
      return await updatePanelDividerRequest(
        panelId,
        dividerOrientation,
        dividerWeight,
        dividerColor,
      );
    } catch {
      return rejectWithValue("Failed to update divider settings.");
    }
  },
);

/** PATCH a `form` panel's whole config from the builder's Save. */
export const updatePanelForm = createAsyncThunk<
  Panel,
  { panelId: string; config: FormPanelConfig },
  { rejectValue: string }
>("panels/updatePanelForm", async ({ panelId, config }, { rejectWithValue }) => {
  try {
    return await updatePanelFormRequest(panelId, config);
  } catch {
    return rejectWithValue("Failed to save form settings.");
  }
});

/** PATCH an `output` panel's `controls` list from `OutputControlsEditor`'s Save. */
export const updatePanelOutputControls = createAsyncThunk<
  Panel,
  { panelId: string; controls: OutputControlSpec[] },
  { rejectValue: string }
>("panels/updatePanelOutputControls", async ({ panelId, controls }, { rejectWithValue }) => {
  try {
    return await updatePanelOutputControlsRequest(panelId, controls);
  } catch {
    return rejectWithValue("Failed to save control settings.");
  }
});

export const updatePanelsBatch = createAsyncThunk<
  UpdatePanelsBatchResponse,
  UpdatePanelsBatchRequest,
  { rejectValue: string }
>("panels/updatePanelsBatch", async (request, { rejectWithValue }) => {
  try {
    return await updatePanelsBatchRequest(request);
  } catch {
    // HEL-535 evaluation-1.md CR3 — this string IS the toast the user sees;
    // `payload ?? "..."` in toastListeners.ts's ERROR_TOASTS table can never
    // reach its own fallback, because this catch always supplies a defined
    // payload. Keep the two in sync if either changes.
    return rejectWithValue("Failed to save panel changes.");
  }
});

/** HEL-1191 design.md D3a — rejection code for a cross-filter `eq` the server refused (HTTP 400,
 *  the eq/in cardinality cap grew past its limit). Callers ignore it (no toast, no error state):
 *  the capabilities store has already flipped the Output to client-fallback, which re-derives the
 *  panel's mode and refetches without the `eq`. */
export const CROSS_FILTER_EQ_REJECTED = "cross-filter-eq-rejected" as const;

// An output-kind panel reads rows from its bound Output
// (`GET /api/outputs/:id/rows`); pagination is sliced on the client.
//
// HEL-1027 design.md D1/D4 (task 4.3) — `sort`/`filter` are optional so every pre-existing
// dispatch (`usePanelData`'s own initial fetch) keeps compiling and behaving identically;
// `usePanelSortFilter` is the caller that passes them, on a (debounced) sort/filter change,
// always paired with `page: 0`. `PanelCardBody.tsx`'s "Load more" (page > 0) also carries them, so an
// appended page never silently reverts to the raw/unfiltered default. skeptic-final-1.md CR2 —
// this thunk does NOT itself sequence responses; staleness is discarded downstream in
// `panelsSlice.ts`'s `.fulfilled`/`.rejected` via `latestFetchRequestId`.
export const fetchPanelPage = createAsyncThunk<
  {
    panelId: string;
    page: number;
    rows: Record<string, unknown>[];
    hasMore: boolean;
    materialized: boolean;
    total: number;
    metric?: FilteredMetric | null;
    /** HEL-1705 H: the page's column order, and the Output's declared schema names (from its cached meta) the reducer merges
     *  pages with. */
    columns?: string[];
    schemaNames?: string[];
    /** HEL-1392 — `outputFreshness` generation at the moment this request started. */
    generation?: number;
  },
  {
    panelId: string;
    /** HEL-1780: the panel's own dashboard, which decides the read route (never the selected dashboard). */
    dashboardId: string;
    outputId: string;
    page: number;
    pageSize: number;
    sort?: OutputRowsSort;
    filter?: OutputRowsFilter;
    /** HEL-1191 design.md D9a-i — the dashboard cross-filter's `eq` term, folded into
     *  `filter.ops` HERE (the single compose point, via `composeOutputRowsFilter`) and never
     *  concatenated into a caller's control ops (C4). */
    crossFilterEq?: CrossFilterEq | null;
  },
  {
    state: RootState;
    rejectValue: {
      message: string;
      kind: RequestErrorKind;
      code?: typeof CROSS_FILTER_EQ_REJECTED;
    };
    /** HEL-1575 D4 -- the server-time instant the request started. */
    pendingMeta: { capturedAt: number };
  }
>(
  "panels/fetchPanelPage",
  async (
    { panelId, dashboardId, outputId, page, pageSize, sort, filter, crossFilterEq },
    { rejectWithValue, getState },
  ) => {
    const generation = currentGeneration(outputId);
    try {
      const offset = page * pageSize;
      // HEL-1773/HEL-1780: a panel on a dashboard the caller does not own is read through the dashboard-scoped per-panel
      // route (admitted by the caller's grant), never `GET /api/outputs/:id/rows`. The decision is the panel's OWN
      // dashboard's (`panelReadScopeFor`, fail-closed, one rule for the hooks and this thunk). The route accepts a sort or
      // filter only on the panel's own control columns and rejects `quick`, so only that part of the intent is sent
      // (`splitForPanelScope`); the rest is applied in the browser over the loaded rows. A panel not in state sends
      // neither (still per-panel).
      const state = getState();
      const readScope = panelReadScopeFor(state, dashboardId, panelId);
      if (readScope.kind === "panel") {
        const scopedPanel = state.panels.items.find((p) => p.id === panelId);
        const { server } = splitForPanelScope(
          { sort, filter, crossFilterEq },
          panelControlColumns(scopedPanel),
        );
        const result = await fetchPublicPanelRows(
          dashboardId,
          panelId,
          undefined,
          offset,
          pageSize,
          server.sort,
          server.filter,
        );
        return {
          panelId,
          page,
          rows: result.items,
          hasMore: offset + pageSize < result.total,
          // The per-panel route answers 200 with `items: []` for an Output that never ran; it carries no flag for it.
          materialized: true,
          total: result.total,
          metric: result.metric,
          columns: result.columns,
          schemaNames: getOutputMetaCached(outputId)?.schema.map((f) => f.name),
          generation,
        };
      }
      const effectiveFilter = crossFilterEq
        ? composeOutputRowsFilter(filter, [
            ...(filter?.ops ?? []),
            { column: crossFilterEq.column, op: "eq", value: crossFilterEq.value },
          ])
        : filter;
      const result = await getOutputRows(outputId, offset, pageSize, sort, effectiveFilter);
      const hasMore = offset + pageSize < result.total;
      return {
        panelId,
        page,
        rows: result.items,
        hasMore,
        materialized: result.materialized,
        total: result.total,
        metric: result.metric,
        columns: result.columns,
        schemaNames: getOutputMetaCached(outputId)?.schema.map((f) => f.name),
        generation,
      };
    } catch (err: unknown) {
      // HEL-1191 design.md D3a — read the raw HTTP status BEFORE `classifyRequestError` (which
      // maps only 403/404 and drops 400). The trigger is the explicit `crossFilterEq` arg, never
      // an inference from `filter.ops`, so a same-column viewer-control `eq` that 400s is not
      // misread as a cardinality-cap rejection.
      if (crossFilterEq != null && isAxiosError(err) && err.response?.status === 400) {
        invalidateCapabilities(
          panelReadScopeFor(getState(), dashboardId, panelId).kind === "panel"
            ? panelCapabilitiesKey(dashboardId, panelId)
            : outputId,
        );
        return rejectWithValue({
          ...classifyRequestError(err, "Failed to load panel data."),
          code: CROSS_FILTER_EQ_REJECTED,
        });
      }
      return rejectWithValue(classifyRequestError(err, "Failed to load panel data."));
    }
  },
  { getPendingMeta: () => ({ capturedAt: serverNowMs() }) },
);
