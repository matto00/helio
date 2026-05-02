import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Provider, useDispatch, useSelector } from "react-redux";

import { App } from "./app/App";
import { OverlayProvider } from "./components/OverlayProvider";
import { updateUserPreferences } from "./features/auth/authSlice";
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

  function handleAccentChange(color: string) {
    if (isAuthenticated) {
      dispatch(
        updateUserPreferences({
          fields: ["accentColor"],
          user: { accentColor: color },
        }),
      );
    }
  }

  return (
    <ThemeProvider onAccentChange={handleAccentChange}>
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
