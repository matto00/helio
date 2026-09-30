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

import {
  composeOutputRowsFilter,
  getOutputRows,
  type OutputRowsFilter,
  type OutputRowsSort,
} from "../../pipelines/services/outputService";
import {
  classifyRequestError,
  type RequestErrorKind,
} from "../../../services/classifyRequestError";
import type { RootState } from "../../../store/store";
import { invalidateCapabilities } from "./filterCapabilitiesStore";
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
import { setDashboardLayoutLocally } from "../../dashboards/state/dashboardsSlice";
import { dashboardGridCols, scaleLayoutItem } from "../../dashboards/state/dashboardLayout";

export const fetchPanels = createAsyncThunk<
  Panel[],
  string,
  { state: RootState; rejectValue: string }
>(
  "panels/fetchPanels",
  async (dashboardId, { rejectWithValue }) => {
    try {
      return await fetchPanelsRequest(dashboardId);
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
      const createdPanel = await createPanelRequest(dashboardId, type, title, outputId, config);
      // Decision-15 (HEL-909 CR6/spec `output-picker/spec.md`): the server
      // computes and returns the placed layout on `createdPanel.layout` —
      // merge it into the dashboard's own layout locally so the grid
      // renders it at its real size immediately, without waiting on a full
      // dashboard refetch. HEL-909 CR1 cycle-2 fix: append the new item to
      // EACH breakpoint's own existing array (never replace md/sm/xs with
      // lg's array — that destroyed independently-customized arrangements),
      // scaling w/x to that breakpoint's column count via `scaleLayoutItem`
      // (mirroring the backend's identical `scaleItemToBreakpoint`) instead
      // of copying lg's dimensions verbatim.
      if (createdPanel.layout) {
        const dashboard = getState().dashboards.items.find((d) => d.id === dashboardId);
        if (dashboard) {
          const lgItem = { panelId: createdPanel.id, ...createdPanel.layout };
          const lgCols = dashboardGridCols.lg ?? 12;
          dispatch(
            setDashboardLayoutLocally({
              dashboardId,
              layout: {
                lg: [...dashboard.layout.lg, lgItem],
                md: [
                  ...dashboard.layout.md,
                  scaleLayoutItem(lgItem, lgCols, dashboardGridCols.md ?? lgCols),
                ],
                sm: [
                  ...dashboard.layout.sm,
                  scaleLayoutItem(lgItem, lgCols, dashboardGridCols.sm ?? lgCols),
                ],
                xs: [
                  ...dashboard.layout.xs,
                  scaleLayoutItem(lgItem, lgCols, dashboardGridCols.xs ?? lgCols),
                ],
              },
            }),
          );
        }
      }
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
      const updated = await patchPanelOutputIdRequest(panelId, outputId);
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
    await deletePanelRequest(panelId);
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
>("panels/duplicatePanel", async ({ panelId, dashboardId }, { dispatch, rejectWithValue }) => {
  try {
    const created = await duplicatePanelRequest(panelId);
    dispatch(markDashboardPanelsStale(dashboardId));
    await dispatch(fetchPanels(dashboardId));
    return created;
  } catch {
    return rejectWithValue("Failed to duplicate panel.");
  }
});

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
// always paired with `page: 0`. `PanelCard.tsx`'s "Load more" (page > 0) also carries them, so an
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
  },
  {
    panelId: string;
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
  }
>(
  "panels/fetchPanelPage",
  async (
    { panelId, outputId, page, pageSize, sort, filter, crossFilterEq },
    { rejectWithValue },
  ) => {
    try {
      const offset = page * pageSize;
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
      };
    } catch (err: unknown) {
      // HEL-1191 design.md D3a — read the raw HTTP status BEFORE `classifyRequestError` (which
      // maps only 403/404 and drops 400). The trigger is the explicit `crossFilterEq` arg, never
      // an inference from `filter.ops`, so a same-column viewer-control `eq` that 400s is not
      // misread as a cardinality-cap rejection.
      if (crossFilterEq != null && isAxiosError(err) && err.response?.status === 400) {
        invalidateCapabilities(outputId);
        return rejectWithValue({
          ...classifyRequestError(err, "Failed to load panel data."),
          code: CROSS_FILTER_EQ_REJECTED,
        });
      }
      return rejectWithValue(classifyRequestError(err, "Failed to load panel data."));
    }
  },
);
