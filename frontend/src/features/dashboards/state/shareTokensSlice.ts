// HEL-590 -- state for the dashboard share-link management dialog (create/list/revoke).
// Keyed by dashboardId since a user can open the dialog for any dashboard they own; mirrors
// `settingsSlice.ts`'s `apiTokens` sub-state shape (status/error/createdToken/revokeStatus).

import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { isAxiosError } from "axios";

import {
  createShareToken as createShareTokenRequest,
  listShareTokens,
  revokeShareToken as revokeShareTokenRequest,
} from "../services/shareTokenService";
import type { CreateShareTokenResponse, ShareTokenResponse } from "../types/shareToken";

/** Matches `outputsSlice.ts`'s existing error-extraction pattern -- the backend's
 *  `ErrorResponse(message)` always uses the `message` field name. */
function extractErrorMessage(err: unknown, fallback: string): string {
  if (isAxiosError(err) && typeof err.response?.data?.message === "string") {
    return err.response.data.message;
  }
  return fallback;
}

type AsyncStatus = "idle" | "loading" | "succeeded" | "failed";

interface DashboardShareTokensState {
  items: ShareTokenResponse[];
  status: AsyncStatus;
  error: string | null;

  createStatus: AsyncStatus;
  createError: string | null;
  /** Cleared by `dismissCreatedShareToken` once the caller has copied it -- mirrors
   *  `settingsSlice.ts`'s `apiTokens.createdToken` shown-once-reveal pattern. */
  createdToken: CreateShareTokenResponse | null;

  revokeStatus: Record<string, AsyncStatus>;
  revokeError: Record<string, string | null>;
}

interface ShareTokensState {
  byDashboard: Record<string, DashboardShareTokensState>;
}

function emptyDashboardState(): DashboardShareTokensState {
  return {
    items: [],
    status: "idle",
    error: null,
    createStatus: "idle",
    createError: null,
    createdToken: null,
    revokeStatus: {},
    revokeError: {},
  };
}

const initialState: ShareTokensState = { byDashboard: {} };

function dashboardState(state: ShareTokensState, dashboardId: string): DashboardShareTokensState {
  const existing = state.byDashboard[dashboardId];
  if (existing !== undefined) return existing;
  const created = emptyDashboardState();
  state.byDashboard[dashboardId] = created;
  return created;
}

export const fetchShareTokens = createAsyncThunk<
  { dashboardId: string; items: ShareTokenResponse[] },
  string,
  { rejectValue: { dashboardId: string; message: string } }
>("shareTokens/fetch", async (dashboardId, { rejectWithValue }) => {
  try {
    const items = await listShareTokens(dashboardId);
    return { dashboardId, items };
  } catch (err) {
    return rejectWithValue({
      dashboardId,
      message: extractErrorMessage(err, "Failed to load share links."),
    });
  }
});

export const createShareTokenThunk = createAsyncThunk<
  { dashboardId: string; token: CreateShareTokenResponse },
  { dashboardId: string; expiresAt?: string },
  { rejectValue: { dashboardId: string; message: string } }
>("shareTokens/create", async ({ dashboardId, expiresAt }, { rejectWithValue }) => {
  try {
    const token = await createShareTokenRequest(dashboardId, { expiresAt });
    return { dashboardId, token };
  } catch (err) {
    return rejectWithValue({
      dashboardId,
      message: extractErrorMessage(err, "Failed to create share link."),
    });
  }
});

export const revokeShareTokenThunk = createAsyncThunk<
  { dashboardId: string; tokenId: string },
  { dashboardId: string; tokenId: string },
  { rejectValue: { dashboardId: string; tokenId: string; message: string } }
>("shareTokens/revoke", async ({ dashboardId, tokenId }, { rejectWithValue }) => {
  try {
    await revokeShareTokenRequest(dashboardId, tokenId);
    return { dashboardId, tokenId };
  } catch (err) {
    return rejectWithValue({
      dashboardId,
      tokenId,
      message: extractErrorMessage(err, "Failed to revoke share link."),
    });
  }
});

const shareTokensSlice = createSlice({
  name: "shareTokens",
  initialState,
  reducers: {
    dismissCreatedShareToken(state, action: PayloadAction<string>) {
      const dashboardId = action.payload;
      dashboardState(state, dashboardId).createdToken = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchShareTokens.pending, (state, action) => {
        const s = dashboardState(state, action.meta.arg);
        s.status = "loading";
        s.error = null;
      })
      .addCase(fetchShareTokens.fulfilled, (state, action) => {
        const s = dashboardState(state, action.payload.dashboardId);
        s.items = action.payload.items;
        s.status = "succeeded";
        s.error = null;
      })
      .addCase(fetchShareTokens.rejected, (state, action) => {
        const dashboardId = action.payload?.dashboardId ?? action.meta.arg;
        const s = dashboardState(state, dashboardId);
        s.status = "failed";
        s.error = action.payload?.message ?? "Failed to load share links.";
      })
      .addCase(createShareTokenThunk.pending, (state, action) => {
        const s = dashboardState(state, action.meta.arg.dashboardId);
        s.createStatus = "loading";
        s.createError = null;
      })
      .addCase(createShareTokenThunk.fulfilled, (state, action) => {
        const s = dashboardState(state, action.payload.dashboardId);
        s.createStatus = "succeeded";
        s.createError = null;
        s.createdToken = action.payload.token;
        s.items.push({
          id: action.payload.token.id,
          dashboardId: action.payload.token.dashboardId,
          expiresAt: action.payload.token.expiresAt,
          revokedAt: null,
          createdAt: action.payload.token.createdAt,
        });
      })
      .addCase(createShareTokenThunk.rejected, (state, action) => {
        const dashboardId = action.payload?.dashboardId ?? action.meta.arg.dashboardId;
        const s = dashboardState(state, dashboardId);
        s.createStatus = "failed";
        s.createError = action.payload?.message ?? "Failed to create share link.";
      })
      .addCase(revokeShareTokenThunk.pending, (state, action) => {
        const s = dashboardState(state, action.meta.arg.dashboardId);
        s.revokeStatus[action.meta.arg.tokenId] = "loading";
        s.revokeError[action.meta.arg.tokenId] = null;
      })
      .addCase(revokeShareTokenThunk.fulfilled, (state, action) => {
        const { dashboardId, tokenId } = action.payload;
        const s = dashboardState(state, dashboardId);
        // HEL-590 (evaluation-1.md CR3): mark revoked, never delete -- a revoked link still
        // existed and was shared; removing it from the list destroys that audit trail and, worse,
        // can make the dialog show "No share links yet" while the server still holds the row
        // (falsely implying nothing was ever shared).
        s.items = s.items.map((t) =>
          t.id === tokenId ? { ...t, revokedAt: t.revokedAt ?? new Date().toISOString() } : t,
        );
        s.revokeStatus[tokenId] = "succeeded";
        s.revokeError[tokenId] = null;
      })
      .addCase(revokeShareTokenThunk.rejected, (state, action) => {
        const dashboardId = action.payload?.dashboardId ?? action.meta.arg.dashboardId;
        const tokenId = action.payload?.tokenId ?? action.meta.arg.tokenId;
        const s = dashboardState(state, dashboardId);
        s.revokeStatus[tokenId] = "failed";
        s.revokeError[tokenId] = action.payload?.message ?? "Failed to revoke share link.";
      });
  },
});

export const { dismissCreatedShareToken } = shareTokensSlice.actions;
export const shareTokensReducer = shareTokensSlice.reducer;

export function selectShareTokensForDashboard(
  state: { shareTokens: ShareTokensState },
  dashboardId: string,
): DashboardShareTokensState {
  return state.shareTokens.byDashboard[dashboardId] ?? emptyDashboardState();
}
