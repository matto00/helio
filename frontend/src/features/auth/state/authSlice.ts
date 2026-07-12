import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { isAxiosError } from "axios";

import {
  getMeRequest,
  loginRequest,
  logoutRequest,
  oauthCallbackRequest,
  registerRequest,
  updateUserPreferencesRequest,
} from "../services/authService";
import { applyAccentTokens } from "../../../theme/appearance";
import type {
  AuthResponse,
  UpdateUserPreferenceRequest,
  User,
  UserPreferences,
} from "../types/user";

export interface AuthState {
  currentUser: User | null;
  status: "idle" | "loading" | "authenticated" | "unauthenticated";
}

const initialState: AuthState = {
  currentUser: null,
  status: "idle",
};

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
  AuthResponse,
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
  AuthResponse,
  { code: string; state?: string },
  { rejectValue: string }
>("auth/handleOAuthCallback", async ({ code, state }, { rejectWithValue }) => {
  try {
    return await oauthCallbackRequest(code, state);
  } catch {
    return rejectWithValue("OAuth sign-in failed.");
  }
});

export const logout = createAsyncThunk<void, void>("auth/logout", async (_, { dispatch }) => {
  try {
    await logoutRequest();
  } catch {
    // fire-and-forget; always clear local state
  }
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

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    setAuth(state, action: PayloadAction<{ user: User }>) {
      state.currentUser = action.payload.user;
      state.status = "authenticated";
      if (action.payload.user.preferences?.accentColor) {
        applyAccentTokens(action.payload.user.preferences.accentColor);
      }
    },
    clearAuth(state) {
      state.currentUser = null;
      state.status = "unauthenticated";
    },
  },
  extraReducers: (builder) => {
    builder
      // rehydrateAuth — state is set by the setAuth/clearAuth dispatches
      // inside the thunk; only the pending status needs handling here.
      .addCase(rehydrateAuth.pending, (state) => {
        state.status = "loading";
      })
      // login
      .addCase(login.pending, (state) => {
        state.status = "loading";
      })
      .addCase(login.fulfilled, (state, action) => {
        state.currentUser = action.payload.user;
        state.status = "authenticated";
        if (action.payload.user.preferences?.accentColor) {
          applyAccentTokens(action.payload.user.preferences.accentColor);
        }
      })
      .addCase(login.rejected, (state) => {
        state.status = "unauthenticated";
      })
      // register
      .addCase(register.pending, (state) => {
        state.status = "loading";
      })
      .addCase(register.fulfilled, (state, action) => {
        state.currentUser = action.payload.user;
        state.status = "authenticated";
        if (action.payload.user.preferences?.accentColor) {
          applyAccentTokens(action.payload.user.preferences.accentColor);
        }
      })
      .addCase(register.rejected, (state) => {
        state.status = "unauthenticated";
      })
      // handleOAuthCallback
      .addCase(handleOAuthCallback.pending, (state) => {
        state.status = "loading";
      })
      .addCase(handleOAuthCallback.fulfilled, (state, action) => {
        state.currentUser = action.payload.user;
        state.status = "authenticated";
        if (action.payload.user.preferences?.accentColor) {
          applyAccentTokens(action.payload.user.preferences.accentColor);
        }
      })
      .addCase(handleOAuthCallback.rejected, (state) => {
        state.currentUser = null;
        state.status = "unauthenticated";
      })
      // logout — clearAuth is dispatched from the thunk, handled by reducers
      .addCase(logout.fulfilled, () => {
        // state is already cleared by the clearAuth action dispatched inside the thunk
      })
      // updateUserPreferences
      .addCase(updateUserPreferences.fulfilled, (state, action) => {
        if (state.currentUser) {
          state.currentUser.preferences = action.payload;
        }
      });
  },
});

export const { setAuth, clearAuth } = authSlice.actions;
export const authReducer = authSlice.reducer;
