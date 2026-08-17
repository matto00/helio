import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { isAxiosError } from "axios";

import {
  clearAgentMemory as clearAgentMemoryRequest,
  deleteAgentMemoryEntry as deleteAgentMemoryEntryRequest,
  getPreferences,
  listAgentMemory,
  putPreferences,
  redeemInviteCode as redeemInviteCodeRequest,
  requestBetaAccess as requestBetaAccessRequest,
} from "../services/settingsService";
// HEL-702: the MFA HTTP wrappers live in `authService.ts` (task 3.2 — they
// hang off `/api/auth/mfa/*`), but the Settings "Security" section's own
// loading/error state follows this feature's own settingsSlice layout
// (design.md D7), so this slice imports them directly rather than
// duplicating request plumbing into `settingsService.ts`.
import {
  mfaConfirmRequest,
  mfaDisableRequest,
  mfaEnrollRequest,
  mfaRegenerateRequest,
  mfaStatusRequest,
} from "../../auth/services/authService";
import { setAuth } from "../../auth/state/authSlice";
import type { AgentMemoryEntry } from "../types/agentMemory";
import type { AgentPreferences, PutAgentPreferencesRequest } from "../types/preferences";
import type {
  MfaBackupCodesResponse,
  MfaEnrollResponse,
  MfaStatusResponse,
  User,
} from "../../auth/types/user";

/** Matches `pipelinesSlice.ts`/`metricsSlice.ts`'s existing error-extraction
 *  pattern: the backend's `ErrorResponse(message)` always uses the `message`
 *  field name. Duplicated per-slice rather than extracted to a shared
 *  helper, matching existing house style. */
function extractErrorMessage(err: unknown, fallback: string): string {
  if (isAxiosError(err) && typeof err.response?.data?.message === "string") {
    return err.response.data.message;
  }
  return fallback;
}

type AsyncStatus = "idle" | "loading" | "succeeded" | "failed";

interface PreferencesState {
  data: AgentPreferences | null;
  status: AsyncStatus;
  error: string | null;
  saveStatus: AsyncStatus;
  saveError: string | null;
}

interface AgentMemoryState {
  items: AgentMemoryEntry[];
  status: AsyncStatus;
  error: string | null;
  /** Keyed by entry id — mirrors `pipelinesSlice.ts`'s per-id `stepsStatus`/
   *  `stepsError` shape so one entry's failed delete never clobbers
   *  another's in-flight state. */
  deleteStatus: Record<string, AsyncStatus>;
  deleteError: Record<string, string | null>;
  clearStatus: AsyncStatus;
  clearError: string | null;
}

/** HEL-702 design.md D7: the Settings "Security" section's state, following
 *  this slice's existing per-sub-tree async-status shape. `enrollment` and
 *  `backupCodes` are transient UI state for the enroll modal / one-time
 *  backup-codes display — never persisted, cleared by `dismissMfaEnrollment`
 *  / `dismissMfaBackupCodes`. */
interface MfaState {
  status: AsyncStatus;
  error: string | null;
  enabled: boolean;
  verifiedAt: string | null;
  backupCodesRemaining: number;

  enrollStatus: AsyncStatus;
  enrollError: string | null;
  enrollment: MfaEnrollResponse | null;

  confirmStatus: AsyncStatus;
  confirmError: string | null;

  /** Set once, by confirm or regenerate — plaintext, shown to the user
   *  exactly once (design.md D6). */
  backupCodes: string[] | null;

  regenerateStatus: AsyncStatus;
  regenerateError: string | null;

  disableStatus: AsyncStatus;
  disableError: string | null;
}

/** HEL-704: request-access and redeem are independent actions a `free`-tier user can trigger
 *  from the same Settings section — separate status/error pairs so one in-flight/failed action
 *  never clobbers the other's UI state. */
interface BetaAccessState {
  requestStatus: AsyncStatus;
  requestError: string | null;
  redeemStatus: AsyncStatus;
  redeemError: string | null;
}

/** design.md Decision 1: one `settingsSlice` holding preferences and agent
 *  memory as two sibling sub-trees, not two separate slices. HEL-702 adds `mfa` and HEL-704 adds
 *  `betaAccess` as two more siblings, same convention. */
interface SettingsState {
  preferences: PreferencesState;
  agentMemory: AgentMemoryState;
  mfa: MfaState;
  betaAccess: BetaAccessState;
}

const initialState: SettingsState = {
  preferences: {
    data: null,
    status: "idle",
    error: null,
    saveStatus: "idle",
    saveError: null,
  },
  agentMemory: {
    items: [],
    status: "idle",
    error: null,
    deleteStatus: {},
    deleteError: {},
    clearStatus: "idle",
    clearError: null,
  },
  mfa: {
    status: "idle",
    error: null,
    enabled: false,
    verifiedAt: null,
    backupCodesRemaining: 0,
    enrollStatus: "idle",
    enrollError: null,
    enrollment: null,
    confirmStatus: "idle",
    confirmError: null,
    backupCodes: null,
    regenerateStatus: "idle",
    regenerateError: null,
    disableStatus: "idle",
    disableError: null,
  },
  betaAccess: {
    requestStatus: "idle",
    requestError: null,
    redeemStatus: "idle",
    redeemError: null,
  },
};

export const fetchPreferences = createAsyncThunk<AgentPreferences, void, { rejectValue: string }>(
  "settings/fetchPreferences",
  async (_, { rejectWithValue }) => {
    try {
      return await getPreferences();
    } catch (err: unknown) {
      return rejectWithValue(extractErrorMessage(err, "Failed to load preferences."));
    }
  },
);

/** Callers are responsible for sending the complete, merged object for every
 *  field they want preserved (design.md Decision 4) — this thunk is a thin
 *  passthrough to `putPreferences`. */
export const savePreferences = createAsyncThunk<
  AgentPreferences,
  PutAgentPreferencesRequest,
  { rejectValue: string }
>("settings/savePreferences", async (request, { rejectWithValue }) => {
  try {
    return await putPreferences(request);
  } catch (err: unknown) {
    return rejectWithValue(extractErrorMessage(err, "Failed to save preferences."));
  }
});

export const fetchAgentMemory = createAsyncThunk<AgentMemoryEntry[], void, { rejectValue: string }>(
  "settings/fetchAgentMemory",
  async (_, { rejectWithValue }) => {
    try {
      return await listAgentMemory();
    } catch (err: unknown) {
      return rejectWithValue(extractErrorMessage(err, "Failed to load agent memory."));
    }
  },
);

export const deleteAgentMemoryEntryThunk = createAsyncThunk<
  string,
  string,
  { rejectValue: string }
>("settings/deleteAgentMemoryEntry", async (id, { rejectWithValue }) => {
  try {
    await deleteAgentMemoryEntryRequest(id);
    return id;
  } catch (err: unknown) {
    return rejectWithValue(extractErrorMessage(err, "Failed to delete memory entry."));
  }
});

export const clearAgentMemoryThunk = createAsyncThunk<void, void, { rejectValue: string }>(
  "settings/clearAgentMemory",
  async (_, { rejectWithValue }) => {
    try {
      await clearAgentMemoryRequest();
    } catch (err: unknown) {
      return rejectWithValue(extractErrorMessage(err, "Failed to clear agent memory."));
    }
  },
);

// ── MFA "Security" section (HEL-702, design.md D7) ──────────────────────────

export const fetchMfaStatus = createAsyncThunk<MfaStatusResponse, void, { rejectValue: string }>(
  "settings/fetchMfaStatus",
  async (_, { rejectWithValue }) => {
    try {
      return await mfaStatusRequest();
    } catch (err: unknown) {
      return rejectWithValue(extractErrorMessage(err, "Failed to load MFA status."));
    }
  },
);

/** HEL-704: `POST /api/beta-access/request` — no payload, no success value; the endpoint's
 *  error status (503 unconfigured / 429 cooldown / 409 not-eligible) surfaces via
 *  `extractErrorMessage`, same as every other thunk in this slice. */
export const requestBetaAccessThunk = createAsyncThunk<void, void, { rejectValue: string }>(
  "settings/requestBetaAccess",
  async (_, { rejectWithValue }) => {
    try {
      await requestBetaAccessRequest();
    } catch (err: unknown) {
      return rejectWithValue(extractErrorMessage(err, "Failed to request Beta access."));
    }
  },
);

export const startMfaEnrollment = createAsyncThunk<
  MfaEnrollResponse,
  void,
  { rejectValue: string }
>("settings/startMfaEnrollment", async (_, { rejectWithValue }) => {
  try {
    return await mfaEnrollRequest();
  } catch (err: unknown) {
    return rejectWithValue(extractErrorMessage(err, "Failed to start enrollment."));
  }
});

export const confirmMfaEnrollment = createAsyncThunk<
  MfaBackupCodesResponse,
  string,
  { rejectValue: string }
>("settings/confirmMfaEnrollment", async (code, { rejectWithValue }) => {
  try {
    return await mfaConfirmRequest(code);
  } catch (err: unknown) {
    return rejectWithValue(extractErrorMessage(err, "Invalid code. Please try again."));
  }
});

export const regenerateMfaBackupCodes = createAsyncThunk<
  MfaBackupCodesResponse,
  string,
  { rejectValue: string }
>("settings/regenerateMfaBackupCodes", async (code, { rejectWithValue }) => {
  try {
    return await mfaRegenerateRequest(code);
  } catch (err: unknown) {
    return rejectWithValue(extractErrorMessage(err, "Invalid code. Please try again."));
  }
});

export const disableMfa = createAsyncThunk<void, string, { rejectValue: string }>(
  "settings/disableMfa",
  async (code, { rejectWithValue }) => {
    try {
      await mfaDisableRequest(code);
    } catch (err: unknown) {
      return rejectWithValue(extractErrorMessage(err, "Invalid code. Please try again."));
    }
  },
);

/** HEL-704: `POST /api/beta-access/redeem` — on success, dispatches `setAuth({ user })` with the
 *  endpoint's returned (now `tier: "beta"`) user so tier-gated UI unlocks immediately, without a
 *  re-login (settings-beta-access-ui spec). On failure (invalid/used/foreign code, or a non-free
 *  caller), the auth slice is left untouched and the inline error is shown instead. */
export const redeemInviteCodeThunk = createAsyncThunk<User, string, { rejectValue: string }>(
  "settings/redeemInviteCode",
  async (code, { dispatch, rejectWithValue }) => {
    try {
      const user = await redeemInviteCodeRequest(code);
      dispatch(setAuth({ user }));
      return user;
    } catch (err: unknown) {
      return rejectWithValue(extractErrorMessage(err, "Invalid or already-used invite code"));
    }
  },
);

const settingsSlice = createSlice({
  name: "settings",
  initialState,
  reducers: {
    /** Closes the enroll modal / resets its per-attempt error state — called
     *  on cancel and after the one-time backup codes have been acknowledged. */
    dismissMfaEnrollment(state) {
      state.mfa.enrollStatus = "idle";
      state.mfa.enrollError = null;
      state.mfa.enrollment = null;
      state.mfa.confirmStatus = "idle";
      state.mfa.confirmError = null;
    },
    /** Clears the one-time backup-codes display (confirm or regenerate) once
     *  the user has acknowledged/copied them. */
    dismissMfaBackupCodes(state) {
      state.mfa.backupCodes = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // fetchPreferences
      .addCase(fetchPreferences.pending, (state) => {
        state.preferences.status = "loading";
        state.preferences.error = null;
      })
      .addCase(fetchPreferences.fulfilled, (state, action) => {
        state.preferences.data = action.payload;
        state.preferences.status = "succeeded";
        state.preferences.error = null;
      })
      .addCase(fetchPreferences.rejected, (state, action) => {
        state.preferences.status = "failed";
        state.preferences.error = action.payload ?? "Failed to load preferences.";
      })
      // savePreferences
      .addCase(savePreferences.pending, (state) => {
        state.preferences.saveStatus = "loading";
        state.preferences.saveError = null;
      })
      .addCase(savePreferences.fulfilled, (state, action) => {
        state.preferences.data = action.payload;
        state.preferences.saveStatus = "succeeded";
        state.preferences.saveError = null;
      })
      .addCase(savePreferences.rejected, (state, action) => {
        state.preferences.saveStatus = "failed";
        state.preferences.saveError = action.payload ?? "Failed to save preferences.";
      })
      // fetchAgentMemory
      .addCase(fetchAgentMemory.pending, (state) => {
        state.agentMemory.status = "loading";
        state.agentMemory.error = null;
      })
      .addCase(fetchAgentMemory.fulfilled, (state, action) => {
        state.agentMemory.items = action.payload;
        state.agentMemory.status = "succeeded";
        state.agentMemory.error = null;
      })
      .addCase(fetchAgentMemory.rejected, (state, action) => {
        state.agentMemory.status = "failed";
        state.agentMemory.error = action.payload ?? "Failed to load agent memory.";
      })
      // deleteAgentMemoryEntryThunk
      .addCase(deleteAgentMemoryEntryThunk.pending, (state, action) => {
        const id = action.meta.arg;
        state.agentMemory.deleteStatus[id] = "loading";
        state.agentMemory.deleteError[id] = null;
      })
      .addCase(deleteAgentMemoryEntryThunk.fulfilled, (state, action) => {
        const id = action.payload;
        state.agentMemory.items = state.agentMemory.items.filter((entry) => entry.id !== id);
        state.agentMemory.deleteStatus[id] = "succeeded";
        state.agentMemory.deleteError[id] = null;
      })
      .addCase(deleteAgentMemoryEntryThunk.rejected, (state, action) => {
        const id = action.meta.arg;
        state.agentMemory.deleteStatus[id] = "failed";
        state.agentMemory.deleteError[id] = action.payload ?? "Failed to delete memory entry.";
      })
      // clearAgentMemoryThunk
      .addCase(clearAgentMemoryThunk.pending, (state) => {
        state.agentMemory.clearStatus = "loading";
        state.agentMemory.clearError = null;
      })
      .addCase(clearAgentMemoryThunk.fulfilled, (state) => {
        state.agentMemory.items = [];
        state.agentMemory.clearStatus = "succeeded";
        state.agentMemory.clearError = null;
      })
      .addCase(clearAgentMemoryThunk.rejected, (state, action) => {
        state.agentMemory.clearStatus = "failed";
        state.agentMemory.clearError = action.payload ?? "Failed to clear agent memory.";
      })
      // fetchMfaStatus
      .addCase(fetchMfaStatus.pending, (state) => {
        state.mfa.status = "loading";
        state.mfa.error = null;
      })
      .addCase(fetchMfaStatus.fulfilled, (state, action) => {
        state.mfa.status = "succeeded";
        state.mfa.error = null;
        state.mfa.enabled = action.payload.enabled;
        state.mfa.verifiedAt = action.payload.verifiedAt;
        state.mfa.backupCodesRemaining = action.payload.backupCodesRemaining;
      })
      .addCase(fetchMfaStatus.rejected, (state, action) => {
        state.mfa.status = "failed";
        state.mfa.error = action.payload ?? "Failed to load MFA status.";
      })
      // startMfaEnrollment
      .addCase(startMfaEnrollment.pending, (state) => {
        state.mfa.enrollStatus = "loading";
        state.mfa.enrollError = null;
      })
      .addCase(startMfaEnrollment.fulfilled, (state, action) => {
        state.mfa.enrollStatus = "succeeded";
        state.mfa.enrollError = null;
        state.mfa.enrollment = action.payload;
      })
      .addCase(startMfaEnrollment.rejected, (state, action) => {
        state.mfa.enrollStatus = "failed";
        state.mfa.enrollError = action.payload ?? "Failed to start enrollment.";
      })
      // confirmMfaEnrollment
      .addCase(confirmMfaEnrollment.pending, (state) => {
        state.mfa.confirmStatus = "loading";
        state.mfa.confirmError = null;
      })
      .addCase(confirmMfaEnrollment.fulfilled, (state, action) => {
        state.mfa.confirmStatus = "succeeded";
        state.mfa.confirmError = null;
        state.mfa.enrollment = null;
        state.mfa.enabled = true;
        state.mfa.verifiedAt = new Date().toISOString();
        state.mfa.backupCodesRemaining = action.payload.backupCodes.length;
        state.mfa.backupCodes = action.payload.backupCodes;
      })
      .addCase(confirmMfaEnrollment.rejected, (state, action) => {
        state.mfa.confirmStatus = "failed";
        state.mfa.confirmError = action.payload ?? "Invalid code. Please try again.";
      })
      // regenerateMfaBackupCodes
      .addCase(regenerateMfaBackupCodes.pending, (state) => {
        state.mfa.regenerateStatus = "loading";
        state.mfa.regenerateError = null;
      })
      .addCase(regenerateMfaBackupCodes.fulfilled, (state, action) => {
        state.mfa.regenerateStatus = "succeeded";
        state.mfa.regenerateError = null;
        state.mfa.backupCodesRemaining = action.payload.backupCodes.length;
        state.mfa.backupCodes = action.payload.backupCodes;
      })
      .addCase(regenerateMfaBackupCodes.rejected, (state, action) => {
        state.mfa.regenerateStatus = "failed";
        state.mfa.regenerateError = action.payload ?? "Invalid code. Please try again.";
      })
      // disableMfa
      .addCase(disableMfa.pending, (state) => {
        state.mfa.disableStatus = "loading";
        state.mfa.disableError = null;
      })
      .addCase(disableMfa.fulfilled, (state) => {
        state.mfa.disableStatus = "succeeded";
        state.mfa.disableError = null;
        state.mfa.enabled = false;
        state.mfa.verifiedAt = null;
        state.mfa.backupCodesRemaining = 0;
        state.mfa.backupCodes = null;
      })
      .addCase(disableMfa.rejected, (state, action) => {
        state.mfa.disableStatus = "failed";
        state.mfa.disableError = action.payload ?? "Invalid code. Please try again.";
      })
      // requestBetaAccessThunk
      .addCase(requestBetaAccessThunk.pending, (state) => {
        state.betaAccess.requestStatus = "loading";
        state.betaAccess.requestError = null;
      })
      .addCase(requestBetaAccessThunk.fulfilled, (state) => {
        state.betaAccess.requestStatus = "succeeded";
        state.betaAccess.requestError = null;
      })
      .addCase(requestBetaAccessThunk.rejected, (state, action) => {
        state.betaAccess.requestStatus = "failed";
        state.betaAccess.requestError = action.payload ?? "Failed to request Beta access.";
      })
      // redeemInviteCodeThunk
      .addCase(redeemInviteCodeThunk.pending, (state) => {
        state.betaAccess.redeemStatus = "loading";
        state.betaAccess.redeemError = null;
      })
      .addCase(redeemInviteCodeThunk.fulfilled, (state) => {
        state.betaAccess.redeemStatus = "succeeded";
        state.betaAccess.redeemError = null;
      })
      .addCase(redeemInviteCodeThunk.rejected, (state, action) => {
        state.betaAccess.redeemStatus = "failed";
        state.betaAccess.redeemError = action.payload ?? "Invalid or already-used invite code";
      });
  },
});

export type { SettingsState };
export const { dismissMfaEnrollment, dismissMfaBackupCodes } = settingsSlice.actions;
export const settingsReducer = settingsSlice.reducer;
