import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { isAxiosError } from "axios";

import {
  getMeRequest,
  loginRequest,
  logoutRequest,
  oauthCallbackRequest,
  registerRequest,
  updateUserPreferencesRequest,
} from "../../services/authService";
import { setAuthToken } from "../../services/httpClient";
import { applyAccentTokens } from "../../theme/appearance";
import type {
  AuthResponse,
  UpdateUserPreferenceRequest,
  User,
  UserPreferences,
} from "../../types/models";

interface AuthRootState {
  auth: AuthState;
}

const SESSION_STORAGE_KEY = "helio_auth_token";

export interface AuthState {
  currentUser: User | null;
  token: string | null;
  status: "idle" | "loading" | "authenticated" | "unauthenticated";
}

const initialState: AuthState = {
  currentUser: null,
  token: null,
  status: "idle",
};

export const rehydrateAuth = createAsyncThunk<AuthResponse | null, void, { rejectValue: string }>(
  "auth/rehydrateAuth",
  async (_, { rejectWithValue }) => {
    const token = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!token) {
      return null;
    }
    setAuthToken(token);
    try {
      const user = await getMeRequest();
      return { token, expiresAt: "", user };
    } catch {
      setAuthToken(null);
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      return rejectWithValue("Session expired");
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

export const logout = createAsyncThunk<void, void, { state: AuthRootState }>(
  "auth/logout",
  async (_, { getState, dispatch }) => {
    const token = getState().auth.token;
    if (token) {
      try {
        await logoutRequest(token);
      } catch {
        // fire-and-forget; always clear local state
      }
    }
    dispatch(clearAuth());
  },
);

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
    setAuth(state, action: PayloadAction<{ token: string; user: User }>) {
      state.token = action.payload.token;
      state.currentUser = action.payload.user;
      state.status = "authenticated";
      setAuthToken(action.payload.token);
      sessionStorage.setItem(SESSION_STORAGE_KEY, action.payload.token);
    },
    clearAuth(state) {
      state.token = null;
      state.currentUser = null;
      state.status = "unauthenticated";
      setAuthToken(null);
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    },
  },
  extraReducers: (builder) => {
    builder
      // rehydrateAuth
      .addCase(rehydrateAuth.pending, (state) => {
        state.status = "loading";
      })
      .addCase(rehydrateAuth.fulfilled, (state, action) => {
        if (action.payload) {
          state.token = action.payload.token;
          state.currentUser = action.payload.user;
          state.status = "authenticated";
          if (action.payload.user.preferences?.accentColor) {
            applyAccentTokens(action.payload.user.preferences.accentColor);
          }
        } else {
          state.status = "unauthenticated";
        }
      })
      .addCase(rehydrateAuth.rejected, (state) => {
        state.token = null;
        state.currentUser = null;
        state.status = "unauthenticated";
      })
      // login
      .addCase(login.pending, (state) => {
        state.status = "loading";
      })
      .addCase(login.fulfilled, (state, action) => {
        state.token = action.payload.token;
        state.currentUser = action.payload.user;
        state.status = "authenticated";
        setAuthToken(action.payload.token);
        sessionStorage.setItem(SESSION_STORAGE_KEY, action.payload.token);
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
        state.token = action.payload.token;
        state.currentUser = action.payload.user;
        state.status = "authenticated";
        setAuthToken(action.payload.token);
        sessionStorage.setItem(SESSION_STORAGE_KEY, action.payload.token);
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
        state.token = action.payload.token;
        state.currentUser = action.payload.user;
        state.status = "authenticated";
        setAuthToken(action.payload.token);
        sessionStorage.setItem(SESSION_STORAGE_KEY, action.payload.token);
        if (action.payload.user.preferences?.accentColor) {
          applyAccentTokens(action.payload.user.preferences.accentColor);
        }
      })
      .addCase(handleOAuthCallback.rejected, (state) => {
        state.token = null;
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
