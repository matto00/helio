import React, { useCallback, useMemo } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import { Provider, useDispatch, useSelector } from "react-redux";

import { App } from "./app/App";
import { OverlayProvider } from "./shared/chrome/OverlayProvider";
import {
  applyAppearancePreferences,
  saveAppearancePreferences,
  updateUserPreferences,
} from "./features/auth/state/authSlice";
import type { AppearancePreferencesPatch } from "./features/auth/types/user";
import { setupAuthInterceptor } from "./services/httpClient";
import { setTelemetryIdentity } from "./features/telemetry/track";
import { store, type RootState, type AppDispatch } from "./store/store";
import { resolveAppearance } from "./theme/appearancePrefs";
import { ThemeProvider } from "./theme/ThemeProvider";
import "./theme/theme.css";
import "./shared/ui/tapTarget.css";
import "./shared/ui/disclosureSummary.css";

// The landing page (`/`) deliberately does not register the service worker; only the app shell does.
registerSW({ immediate: true });

// Wire global 401 interceptor — must run before first API call
setupAuthInterceptor(
  (action) => store.dispatch(action as Parameters<typeof store.dispatch>[0]),
  (path) => {
    if (window.location.pathname !== path) {
      window.location.assign(path);
    }
  },
);

setTelemetryIdentity(() => store.getState().auth.currentUser?.id ?? null);

function ThemedApp() {
  const dispatch = useDispatch<AppDispatch>();
  const isAuthenticated = useSelector((state: RootState) => state.auth.status === "authenticated");
  // F-061: the authenticated user's saved accent preference — the one remaining feed into
  // ThemeProvider now that authSlice.ts no longer applies accent tokens to the DOM directly.
  const preferredAccentColor = useSelector(
    (state: RootState) => state.auth.currentUser?.preferences?.accentColor ?? null,
  );

  // HEL-1572: undefined while auth is unresolved (keep what the pre-paint script applied), null once signed out
  // (reset + drop the cache), else the saved values resolved to their defaults.
  const authStatus = useSelector((state: RootState) => state.auth.status);
  const savedTypeStyle = useSelector(
    (state: RootState) => state.auth.currentUser?.preferences?.typeStyle,
  );
  const savedDensity = useSelector(
    (state: RootState) => state.auth.currentUser?.preferences?.density,
  );
  const savedMotion = useSelector(
    (state: RootState) => state.auth.currentUser?.preferences?.motion,
  );
  const preferredAppearance = useMemo(() => {
    if (authStatus === "unauthenticated") return null;
    if (authStatus !== "authenticated") return undefined;
    return resolveAppearance({
      typeStyle: savedTypeStyle,
      density: savedDensity,
      motion: savedMotion,
    });
  }, [authStatus, savedTypeStyle, savedDensity, savedMotion]);

  // Optimistic Redux update first (so the saved value is already in the store), then persist.
  const handleAppearanceChange = useCallback(
    (patch: AppearancePreferencesPatch) => {
      if (!isAuthenticated) return;
      dispatch(applyAppearancePreferences(patch));
      void dispatch(saveAppearancePreferences(patch));
    },
    [dispatch, isAuthenticated],
  );

  function handleAccentChange(color: string) {
    // Guards against PATCHing back a value that just arrived FROM the server via
    // `preferredAccentColor` — without this, ThemeProvider's own sync effect (which calls this
    // same callback path indirectly through a user-driven change) could round-trip a no-op save.
    if (isAuthenticated && color !== preferredAccentColor) {
      dispatch(
        updateUserPreferences({
          fields: ["accentColor"],
          user: { accentColor: color },
        }),
      );
    }
  }

  return (
    <ThemeProvider
      onAccentChange={handleAccentChange}
      preferredAccentColor={preferredAccentColor}
      preferredAppearance={preferredAppearance}
      onAppearanceChange={handleAppearanceChange}
    >
      <OverlayProvider>
        <App />
      </OverlayProvider>
    </ThemeProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <Provider store={store}>
        <ThemedApp />
      </Provider>
    </BrowserRouter>
  </React.StrictMode>,
);
