import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Provider, useDispatch, useSelector } from "react-redux";

import { App } from "./app/App";
import { OverlayProvider } from "./shared/chrome/OverlayProvider";
import { updateUserPreferences } from "./features/auth/state/authSlice";
import { setupAuthInterceptor } from "./services/httpClient";
import { store, type RootState, type AppDispatch } from "./store/store";
import { ThemeProvider } from "./theme/ThemeProvider";
import "./theme/theme.css";

// Wire global 401 interceptor — must run before first API call
setupAuthInterceptor(
  (action) => store.dispatch(action as Parameters<typeof store.dispatch>[0]),
  (path) => {
    if (window.location.pathname !== path) {
      window.location.assign(path);
    }
  },
);

function ThemedApp() {
  const dispatch = useDispatch<AppDispatch>();
  const isAuthenticated = useSelector((state: RootState) => state.auth.status === "authenticated");
  // F-061: the authenticated user's saved accent preference — the one remaining feed into
  // ThemeProvider now that authSlice.ts no longer applies accent tokens to the DOM directly.
  const preferredAccentColor = useSelector(
    (state: RootState) => state.auth.currentUser?.preferences?.accentColor ?? null,
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
    <ThemeProvider onAccentChange={handleAccentChange} preferredAccentColor={preferredAccentColor}>
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
