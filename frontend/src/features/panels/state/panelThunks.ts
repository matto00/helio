// Per-panel CRUD thunks for the CS2c-3c wire shape.
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
  updatePanelAppearance as updatePanelAppearanceRequest,
  updatePanelBinding as updatePanelBindingRequest,
  updatePanelColumnWidths as updatePanelColumnWidthsRequest,
  updatePanelDivider as updatePanelDividerRequest,
  updatePanelImage as updatePanelImageRequest,
  updatePanelsBatch as updatePanelsBatchRequest,
  updatePanelMarkdownBinding as updatePanelMarkdownBindingRequest,
  updatePanelTextBinding as updatePanelTextBindingRequest,
  updatePanelTitle as updatePanelTitleRequest,
  type TableDisplayPatch,
} from "../services/panelService";
import { fetchDataTypeRows } from "../../dataTypes/services/dataTypeService";
import type { RootState } from "../../../store/store";
import type {
  ChartAggregation,
  ChartTypeOptionsMap,
  DividerOrientation,
  ImageFit,
  MetricAggregation,
  Panel,
  PanelAppearance,
  PanelType,
  TypeConfig,
  UpdatePanelsBatchRequest,
  UpdatePanelsBatchResponse,
} from "../types/panel";
import { getDataTypeId } from "./panelNarrowing";

// Imported as a delayed reference to avoid cyclic-import issues on the
// slice's `reducer` symbol. The thunks only need the action creator
// `markDashboardPanelsStale` and the `fetchPanels` thunk itself — both are
// re-exported by the slice once it is constructed.
import { markDashboardPanelsStale } from "./panelActions";

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
    title: string;
    type?: PanelType;
    typeConfig?: TypeConfig;
    dataTypeId?: string;
  },
  { state: RootState; rejectValue: string }
>(
  "panels/createPanel",
  async ({ dashboardId, title, type, typeConfig, dataTypeId }, { dispatch, rejectWithValue }) => {
    try {
      const createdPanel = await createPanelRequest(
        dashboardId,
        title,
        type,
        typeConfig,
        dataTypeId,
      );
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

export const updatePanelBinding = createAsyncThunk<
  Panel,
  {
    panelId: string;
    typeId: string | null;
    fieldMapping: Record<string, string> | null;
    refreshInterval: number | null;
    /** HEL-292: `undefined` = leave unchanged, `null` = explicit clear, an
     *  object = set/replace. See `buildBindingPatch`. */
    aggregation?: MetricAggregation | ChartAggregation | null;
    /** HEL-243: literal label/unit override — `undefined` = leave unchanged,
     *  `null` = explicit clear, a string = set. See `buildBindingPatch`. */
    label?: string | null;
    unit?: string | null;
    /** HEL-255: Table density/columnOrder/width-reset, folded into the same
     *  single Save PATCH. See `TableDisplayPatch`. */
    tableDisplay?: TableDisplayPatch;
    /** HEL-248: Chart per-type display options, folded into the same single
     *  Save PATCH. `undefined` = leave unchanged, `null` = clear, object =
     *  replace. See `buildBindingPatch`. */
    chartOptions?: ChartTypeOptionsMap | null;
  },
  { rejectValue: string }
>(
  "panels/updatePanelBinding",
  async (
    {
      panelId,
      typeId,
      fieldMapping,
      refreshInterval,
      aggregation,
      label,
      unit,
      tableDisplay,
      chartOptions,
    },
    { rejectWithValue },
  ) => {
    try {
      // `aggregation`/`label`/`unit`/`tableDisplay`/`chartOptions` are optional
      // trailing params on `updatePanelBindingRequest`; passing them as
      // `undefined` when the caller didn't supply one is behaviorally identical
      // to omitting the argument.
      return await updatePanelBindingRequest(
        panelId,
        typeId,
        fieldMapping,
        refreshInterval,
        aggregation,
        label,
        unit,
        tableDisplay,
        chartOptions,
      );
    } catch {
      return rejectWithValue("Failed to update panel binding.");
    }
  },
);

/** HEL-255: persist a Table panel's drag-resized column widths AND keep the
 *  Redux-stored panel in sync. The raw `updatePanelColumnWidths` service call
 *  is fire-and-forget (debounced from the grid); routing it through a thunk
 *  whose `fulfilled` reducer replaces the stored panel means `config.
 *  columnWidths` is no longer stale after a same-session resize — so the edit
 *  pane's "Reset column widths" button (gated on `hasStoredWidths`) enables
 *  without a page reload. Mirrors `updatePanelBinding`'s fulfilled sync. */
export const updatePanelColumnWidths = createAsyncThunk<
  Panel,
  { panelId: string; columnWidths: Record<string, number> },
  { rejectValue: string }
>("panels/updatePanelColumnWidths", async ({ panelId, columnWidths }, { rejectWithValue }) => {
  try {
    return await updatePanelColumnWidthsRequest(panelId, columnWidths);
  } catch {
    return rejectWithValue("Failed to persist column widths.");
  }
});

/** HEL-244: PATCH a Text panel's Content editor save — see
 *  `buildContentBindingPatch` for the Source/Static patch-shape rules. */
export const updatePanelTextBinding = createAsyncThunk<
  Panel,
  {
    panelId: string;
    mode: "field" | "literal";
    typeId: string | null;
    fieldValue: string;
    literalValue: string;
  },
  { rejectValue: string }
>(
  "panels/updatePanelTextBinding",
  async ({ panelId, mode, typeId, fieldValue, literalValue }, { rejectWithValue }) => {
    try {
      return await updatePanelTextBindingRequest(panelId, {
        mode,
        typeId,
        fieldValue,
        literalValue,
      });
    } catch {
      return rejectWithValue("Failed to update panel content.");
    }
  },
);

/** HEL-245: PATCH a Markdown panel's Content editor save — mirrors
 *  `updatePanelTextBinding`; see `buildContentBindingPatch` for the
 *  Source/Static patch-shape rules. */
export const updatePanelMarkdownBinding = createAsyncThunk<
  Panel,
  {
    panelId: string;
    mode: "field" | "literal";
    typeId: string | null;
    fieldValue: string;
    literalValue: string;
  },
  { rejectValue: string }
>(
  "panels/updatePanelMarkdownBinding",
  async ({ panelId, mode, typeId, fieldValue, literalValue }, { rejectWithValue }) => {
    try {
      return await updatePanelMarkdownBindingRequest(panelId, {
        mode,
        typeId,
        fieldValue,
        literalValue,
      });
    } catch {
      return rejectWithValue("Failed to update panel content.");
    }
  },
);

export const updatePanelImage = createAsyncThunk<
  Panel,
  { panelId: string; imageUrl: string; imageFit: ImageFit },
  { rejectValue: string }
>("panels/updatePanelImage", async ({ panelId, imageUrl, imageFit }, { rejectWithValue }) => {
  try {
    return await updatePanelImageRequest(panelId, imageUrl, imageFit);
  } catch {
    return rejectWithValue("Failed to update panel image.");
  }
});

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

export const updatePanelsBatch = createAsyncThunk<
  UpdatePanelsBatchResponse,
  UpdatePanelsBatchRequest,
  { rejectValue: string }
>("panels/updatePanelsBatch", async (request, { rejectWithValue }) => {
  try {
    return await updatePanelsBatchRequest(request);
  } catch {
    return rejectWithValue("Failed to update panels.");
  }
});

// Panels read rows from their bound DataType (populated by pipeline runs).
// The rows endpoint returns the full set; pagination is sliced on the client.
export const fetchPanelPage = createAsyncThunk<
  { panelId: string; page: number; rows: Record<string, unknown>[]; hasMore: boolean },
  { panelId: string; page: number; pageSize: number },
  { state: RootState; rejectValue: string }
>("panels/fetchPanelPage", async ({ panelId, page, pageSize }, { getState, rejectWithValue }) => {
  const panel = getState().panels.items.find((p) => p.id === panelId);
  const dataTypeId = panel ? getDataTypeId(panel) : null;
  if (!dataTypeId) {
    return rejectWithValue("Panel is not bound to a data type.");
  }
  try {
    const { rows } = await fetchDataTypeRows(dataTypeId);
    const start = page * pageSize;
    const slice = rows.slice(start, start + pageSize);
    const hasMore = start + pageSize < rows.length;
    return { panelId, page, rows: slice, hasMore };
  } catch {
    return rejectWithValue("Failed to load panel data.");
  }
});
