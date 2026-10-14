import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";

import { clearAuth } from "../../auth/state/authSlice";
import { extractErrorMessage } from "../../../services/extractErrorMessage";
import {
  createDashboardFolder as createRequest,
  deleteDashboardFolder as deleteRequest,
  fetchDashboardFolders as fetchRequest,
  moveDashboardToFolder as moveRequest,
  updateDashboardFolder as updateRequest,
} from "../services/dashboardFolderService";
import type { DashboardFolder } from "../types/dashboardFolder";

export interface DashboardFoldersState {
  folders: DashboardFolder[];
  /** dashboardId -> folderId. */
  assignments: Record<string, string>;
  status: "idle" | "loading" | "succeeded" | "failed";
  error: string | null;
}

const initialState: DashboardFoldersState = {
  folders: [],
  assignments: {},
  status: "idle",
  error: null,
};

type FoldersRoot = { dashboardFolders: DashboardFoldersState };

export const fetchDashboardFolders = createAsyncThunk<
  Awaited<ReturnType<typeof fetchRequest>>,
  void,
  { state: FoldersRoot; rejectValue: string }
>(
  "dashboardFolders/fetch",
  async (_, { rejectWithValue }) => {
    try {
      return await fetchRequest();
    } catch (err) {
      return rejectWithValue(extractErrorMessage(err, "Failed to load folders."));
    }
  },
  {
    condition: (_, { getState }) => {
      const { status } = getState().dashboardFolders;
      return status === "idle" || status === "failed";
    },
  },
);

export const createDashboardFolder = createAsyncThunk<
  DashboardFolder,
  { name: string },
  { rejectValue: string }
>("dashboardFolders/create", async ({ name }, { rejectWithValue }) => {
  try {
    return await createRequest(name);
  } catch (err) {
    return rejectWithValue(extractErrorMessage(err, "Failed to create folder."));
  }
});

export const renameDashboardFolder = createAsyncThunk<
  DashboardFolder,
  { folderId: string; name: string },
  { rejectValue: string }
>("dashboardFolders/rename", async ({ folderId, name }, { rejectWithValue }) => {
  try {
    return await updateRequest(folderId, { name });
  } catch (err) {
    return rejectWithValue(extractErrorMessage(err, "Failed to rename folder."));
  }
});

export const deleteDashboardFolder = createAsyncThunk<
  string,
  { folderId: string },
  { rejectValue: string }
>("dashboardFolders/delete", async ({ folderId }, { rejectWithValue }) => {
  try {
    await deleteRequest(folderId);
    return folderId;
  } catch (err) {
    return rejectWithValue(extractErrorMessage(err, "Failed to delete folder."));
  }
});

/** Optimistic: the reducer flips the flag on `pending`, and rolls it back on `rejected`. */
export const setDashboardFolderCollapsed = createAsyncThunk<
  void,
  { folderId: string; collapsed: boolean },
  { rejectValue: string }
>("dashboardFolders/setCollapsed", async ({ folderId, collapsed }, { rejectWithValue }) => {
  try {
    await updateRequest(folderId, { collapsed });
  } catch (err) {
    return rejectWithValue(extractErrorMessage(err, "Failed to save folder state."));
  }
});

/** Optimistic move; `folderId: null` unfiles. Rolled back on `rejected`. */
export const moveDashboardToFolder = createAsyncThunk<
  void,
  { dashboardId: string; folderId: string | null },
  { rejectValue: string }
>("dashboardFolders/move", async ({ dashboardId, folderId }, { rejectWithValue }) => {
  try {
    await moveRequest(dashboardId, folderId);
  } catch (err) {
    return rejectWithValue(extractErrorMessage(err, "Failed to move dashboard."));
  }
});

function applyAssignment(
  assignments: Record<string, string>,
  dashboardId: string,
  folderId: string | null,
): void {
  if (folderId === null) delete assignments[dashboardId];
  else assignments[dashboardId] = folderId;
}

/** requestId -> the folder the dashboard was filed in before an optimistic move (module-local bookkeeping, never
 *  state: it is only meaningful between one move's `pending` and its settle). */
const previousFilings = new Map<string, string | null>();

const dashboardFoldersSlice = createSlice({
  name: "dashboardFolders",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(clearAuth, () => initialState)
      .addCase(fetchDashboardFolders.pending, (state) => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(fetchDashboardFolders.fulfilled, (state, action) => {
        state.status = "succeeded";
        state.folders = action.payload.folders;
        state.assignments = Object.fromEntries(
          action.payload.assignments.map((a) => [a.dashboardId, a.folderId]),
        );
      })
      .addCase(fetchDashboardFolders.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.payload ?? "Failed to load folders.";
      })
      .addCase(createDashboardFolder.fulfilled, (state, action) => {
        state.folders.push(action.payload);
      })
      .addCase(renameDashboardFolder.fulfilled, (state, action) => {
        const index = state.folders.findIndex((f) => f.id === action.payload.id);
        if (index !== -1) state.folders[index] = action.payload;
      })
      .addCase(deleteDashboardFolder.fulfilled, (state, action) => {
        state.folders = state.folders.filter((f) => f.id !== action.payload);
        for (const [dashboardId, folderId] of Object.entries(state.assignments)) {
          if (folderId === action.payload) delete state.assignments[dashboardId];
        }
      })
      .addCase(setDashboardFolderCollapsed.pending, (state, action) => {
        const folder = state.folders.find((f) => f.id === action.meta.arg.folderId);
        if (folder) folder.collapsed = action.meta.arg.collapsed;
      })
      .addCase(setDashboardFolderCollapsed.rejected, (state, action) => {
        const folder = state.folders.find((f) => f.id === action.meta.arg.folderId);
        if (folder) folder.collapsed = !action.meta.arg.collapsed;
      })
      .addCase(moveDashboardToFolder.pending, (state, action) => {
        const { dashboardId, folderId } = action.meta.arg;
        // Remember the previous filing on the request id so a rejection can restore it.
        previousFilings.set(action.meta.requestId, state.assignments[dashboardId] ?? null);
        applyAssignment(state.assignments, dashboardId, folderId);
      })
      .addCase(moveDashboardToFolder.fulfilled, (_state, action) => {
        previousFilings.delete(action.meta.requestId);
      })
      .addCase(moveDashboardToFolder.rejected, (state, action) => {
        const previous = previousFilings.get(action.meta.requestId) ?? null;
        previousFilings.delete(action.meta.requestId);
        applyAssignment(state.assignments, action.meta.arg.dashboardId, previous);
      });
  },
});

export const dashboardFoldersReducer = dashboardFoldersSlice.reducer;
