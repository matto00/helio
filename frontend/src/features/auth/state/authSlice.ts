import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { isAxiosError } from "axios";

import { resetOutputFreshness } from "../../panels/state/outputFreshness";
import {
  getMeRequest,
  loginRequest,
  logoutRequest,
  mfaVerifyRequest,
  oauthCallbackRequest,
  patchShellPreferencesRequest,
  registerRequest,
  updateUserPreferencesRequest,
} from "../services/authService";
import type {
  AuthResponse,
  LoginResult,
  MfaRequiredResponse,
  AppearancePreferencesPatch,
  PreferencesPatch,
  ShellPreferencesPatch,
  UpdateUserPreferenceRequest,
  User,
  UserPreferences,
} from "../types/user";

export interface AuthState {
  currentUser: User | null;
  status: "idle" | "loading" | "authenticated" | "unauthenticated";
  // F-091: kept separate from `status`, which also carries the unconditional
  // session-rehydration check that fires on every app mount (App.tsx
  // dispatches rehydrateAuth() whenever status is "idle"). Login/register
  // used to derive their submit button's loading state from that same
  // `status` field, so the button read "Signing in…" for every fresh
  // visitor until GET /api/auth/me resolved -- not just while a submit was
  // actually in flight. This flag is only ever touched by login/register.
  submitStatus: "idle" | "loading";
  /** A pending login-time MFA challenge (HEL-702, design.md D7) — transient,
   *  never persisted. Set when `login`/`handleOAuthCallback` fulfills with an
   *  `MfaRequiredResponse` instead of a session; survives the client-side
   *  route hop to `/login/verify` (component-local state cannot). Cleared on
   *  `verifyMfa` success, `logout`, and `clearAuth`. */
  mfaChallenge: { challengeToken: string } | null;
}

const initialState: AuthState = {
  currentUser: null,
  status: "idle",
  submitStatus: "idle",
  mfaChallenge: null,
};

/** Narrows a `LoginResult` union to the MFA-gate branch (HEL-702). */
export function isMfaRequiredResponse(result: LoginResult): result is MfaRequiredResponse {
  return "mfaRequired" in result;
}

// HEL-287 CodeQL #8: the session identity now lives in an HttpOnly cookie
// (never JS-readable), so rehydration on load can't check for a token —
// it calls GET /api/auth/me unconditionally (the cookie attaches
// automatically via httpClient's withCredentials) and lets the response
// (200 = authenticated, 401 = not logged in) decide the outcome.
export const rehydrateAuth = createAsyncThunk<void, void>(
  "auth/rehydrateAuth",
  async (_, { dispatch }) => {
    try {
      const user = await getMeRequest();
      dispatch(setAuth({ user }));
    } catch {
      dispatch(clearAuth());
    }
  },
);

export const login = createAsyncThunk<
  LoginResult,
  { email: string; password: string },
  { rejectValue: string }
>("auth/login", async (credentials, { rejectWithValue }) => {
  try {
    return await loginRequest(credentials);
  } catch (err) {
    const serverMessage =
      isAxiosError(err) && typeof err.response?.data?.message === "string"
        ? err.response.data.message
        : null;
    return rejectWithValue(serverMessage ?? "Login failed.");
  }
});

export const register = createAsyncThunk<
  AuthResponse,
  { email: string; password: string; displayName?: string },
  { rejectValue: string }
>("auth/register", async (payload, { rejectWithValue }) => {
  try {
    return await registerRequest(payload);
  } catch (err) {
    const serverMessage =
      isAxiosError(err) && typeof err.response?.data?.message === "string"
        ? err.response.data.message
        : null;
    return rejectWithValue(serverMessage ?? "Registration failed.");
  }
});

export const handleOAuthCallback = createAsyncThunk<
  LoginResult,
  { code: string; state?: string },
  { rejectValue: string }
>("auth/handleOAuthCallback", async ({ code, state }, { rejectWithValue }) => {
  try {
    return await oauthCallbackRequest(code, state);
  } catch {
    return rejectWithValue("OAuth sign-in failed.");
  }
});

/** HEL-702: exchanges the pending `mfaChallenge` (set by `login`/
 *  `handleOAuthCallback` on the `mfaRequired` branch) plus a TOTP-or-backup
 *  code for a session. Reads the challenge from state (typed to the minimal
 *  `{ auth: AuthState }` shape this thunk actually touches, rather than the
 *  full app `RootState` — keeps this slice self-contained and dispatchable
 *  against an auth-only test store) rather than requiring every caller to
 *  thread it through — `MfaVerifyPage` only ever has one challenge active at
 *  a time. */
export const verifyMfa = createAsyncThunk<
  AuthResponse,
  { code: string },
  { state: { auth: AuthState }; rejectValue: string }
>("auth/verifyMfa", async ({ code }, { getState, rejectWithValue }) => {
  const challenge = getState().auth.mfaChallenge;
  if (challenge === null) {
    return rejectWithValue("No pending verification. Please sign in again.");
  }
  try {
    return await mfaVerifyRequest(challenge.challengeToken, code);
  } catch (err) {
    const serverMessage =
      isAxiosError(err) && typeof err.response?.data?.message === "string"
        ? err.response.data.message
        : null;
    return rejectWithValue(serverMessage ?? "Invalid code. Please try again.");
  }
});

export const logout = createAsyncThunk<void, void>("auth/logout", async (_, { dispatch }) => {
  try {
    await logoutRequest();
  } catch {
    // fire-and-forget; always clear local state
  }
  // HEL-1392 design.md D4 -- the next user must never be served this one's cached Output data.
  resetOutputFreshness();
  dispatch(clearAuth());
});

export const updateUserPreferences = createAsyncThunk<
  UserPreferences,
  UpdateUserPreferenceRequest,
  { rejectValue: string }
>("auth/updateUserPreferences", async (request, { rejectWithValue }) => {
  try {
    return await updateUserPreferencesRequest(request);
  } catch {
    return rejectWithValue("Failed to update user preferences.");
  }
});

/** HEL-1574: persists shell layout keys (context-list width / collapsed). The local value is applied before this
 *  runs (`applyShellPreferences`), so a failure keeps the local value and shows nothing. Only the keys sent are
 *  merged server-side, and the response is deliberately not written back: it could clobber a newer local value. */
export const saveShellPreferences = createAsyncThunk<void, ShellPreferencesPatch>(
  "auth/saveShellPreferences",
  async (patch) => {
    try {
      await patchShellPreferencesRequest(patch);
    } catch {
      // Keep the local value; the next change or the next load reconciles.
    }
  },
);

/** HEL-1572: persists appearance keys (type style / density / motion; `motion: null` clears the choice). Like the
 *  shell write: the local value is applied first (`applyAppearancePreferences`), a failure keeps it silently, and the
 *  response is not written back over newer local state. */
export const saveAppearancePreferences = createAsyncThunk<void, AppearancePreferencesPatch>(
  "auth/saveAppearancePreferences",
  async (patch) => {
    const body: PreferencesPatch = patch;
    try {
      await patchShellPreferencesRequest(body);
    } catch {
      // Keep the local value; the next change or the next load reconciles.
    }
  },
);

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    setAuth(state, action: PayloadAction<{ user: User }>) {
      // HEL-1574: an incoming user with no preferences (a path that predates them) keeps the ones this session
      // already holds for the SAME user, so the shell never snaps back to its defaults. Never carried across users.
      const previous = state.currentUser;
      const incoming = action.payload.user;
      state.currentUser =
        incoming.preferences === undefined && previous?.id === incoming.id
          ? { ...incoming, preferences: previous.preferences }
          : incoming;
      state.status = "authenticated";
      // Accent is applied by ThemeProvider (fed the resulting currentUser's
      // preference from outside this slice), never as a side effect here --
      // see F-061: a reducer writing DOM tokens directly raced ThemeProvider
      // and left the AccentPicker's selection out of sync with what was
      // actually applied.
    },
    /** HEL-1574: applies shell layout keys locally (optimistic); `saveShellPreferences` persists them. */
    applyShellPreferences(state, action: PayloadAction<ShellPreferencesPatch>) {
      if (state.currentUser === null) return;
      state.currentUser.preferences = {
        accentColor: null,
        zoomLevels: {},
        ...state.currentUser.preferences,
        ...action.payload,
      };
    },
    /** HEL-1572: applies appearance keys locally (optimistic); `saveAppearancePreferences` persists them. A `null`
     *  motion removes the saved choice, mirroring the server. */
    applyAppearancePreferences(state, action: PayloadAction<AppearancePreferencesPatch>) {
      if (state.currentUser === null) return;
      const { motion, ...rest } = action.payload;
      const next = {
        accentColor: null,
        zoomLevels: {},
        ...state.currentUser.preferences,
        ...rest,
      };
      if (motion === null) delete next.motion;
      else if (motion !== undefined) next.motion = motion;
      state.currentUser.preferences = next;
    },
    clearAuth(state) {
      state.currentUser = null;
      state.status = "unauthenticated";
      state.mfaChallenge = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // rehydrateAuth — state is set by the setAuth/clearAuth dispatches
      // inside the thunk; only the pending status needs handling here.
      .addCase(rehydrateAuth.pending, (state) => {
        state.status = "loading";
      })
      // login — F-091: submitStatus only, `status` is untouched by .pending
      // so a submit-in-flight never masquerades as the boot-time rehydrate
      // check for ProtectedRoute/PublicOnlyRoute.
      .addCase(login.pending, (state) => {
        state.submitStatus = "loading";
      })
      .addCase(login.fulfilled, (state, action) => {
        // HEL-702 design.md D7: mfaRequired stays "unauthenticated" and
        // stores the challenge for MfaVerifyPage instead of authenticating.
        if (isMfaRequiredResponse(action.payload)) {
          state.mfaChallenge = { challengeToken: action.payload.challengeToken };
          state.status = "unauthenticated";
          state.submitStatus = "idle";
          return;
        }
        state.currentUser = action.payload.user;
        state.status = "authenticated";
        state.submitStatus = "idle";
        state.mfaChallenge = null;
      })
      .addCase(login.rejected, (state) => {
        state.status = "unauthenticated";
        state.submitStatus = "idle";
      })
      // register — same submitStatus treatment as login (F-091).
      .addCase(register.pending, (state) => {
        state.submitStatus = "loading";
      })
      .addCase(register.fulfilled, (state, action) => {
        state.currentUser = action.payload.user;
        state.status = "authenticated";
        state.submitStatus = "idle";
      })
      .addCase(register.rejected, (state) => {
        state.status = "unauthenticated";
        state.submitStatus = "idle";
      })
      .addCase(handleOAuthCallback.pending, (state) => {
        state.status = "loading";
      })
      .addCase(handleOAuthCallback.fulfilled, (state, action) => {
        // HEL-702 design.md D7: same mfaRequired branch as login.fulfilled above.
        if (isMfaRequiredResponse(action.payload)) {
          state.mfaChallenge = { challengeToken: action.payload.challengeToken };
          state.status = "unauthenticated";
          return;
        }
        state.currentUser = action.payload.user;
        state.status = "authenticated";
        state.mfaChallenge = null;
      })
      .addCase(handleOAuthCallback.rejected, (state) => {
        state.currentUser = null;
        state.status = "unauthenticated";
      })
      .addCase(verifyMfa.pending, (state) => {
        state.status = "loading";
      })
      .addCase(verifyMfa.fulfilled, (state, action) => {
        state.currentUser = action.payload.user;
        state.status = "authenticated";
        state.mfaChallenge = null;
      })
      .addCase(verifyMfa.rejected, (state) => {
        // The challenge is intentionally retained on failure — the user can
        // retry until it expires/attempt-caps (design.md D4); only a fresh
        // login/logout/clearAuth clears it.
        state.status = "unauthenticated";
      })
      // logout — clearAuth is dispatched from the thunk, handled by reducers
      .addCase(logout.fulfilled, () => {
        // state is already cleared by the clearAuth action dispatched inside the thunk
      })
      .addCase(updateUserPreferences.fulfilled, (state, action) => {
        if (state.currentUser) {
          // HEL-1574: merge, so the accent/zoom write never drops the shell layout keys held alongside them
          // (and tolerates a response that carries no preferences object).
          state.currentUser.preferences = { ...state.currentUser.preferences, ...action.payload };
        }
      });
  },
});

export const { setAuth, clearAuth, applyShellPreferences, applyAppearancePreferences } =
  authSlice.actions;
export const authReducer = authSlice.reducer;
