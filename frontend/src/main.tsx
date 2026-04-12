import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Provider } from "react-redux";

import { App } from "./app/App";
import { OverlayProvider } from "./components/OverlayProvider";
import { setupAuthInterceptor } from "./services/httpClient";
import { store } from "./store/store";
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

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <Provider store={store}>
          <OverlayProvider>
            <App />
          </OverlayProvider>
        </Provider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
