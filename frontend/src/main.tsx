import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Provider } from "react-redux";

import { App } from "./app/App";
import { OverlayProvider } from "./components/OverlayProvider";
import { store } from "./store/store";
import { ThemeProvider } from "./theme/ThemeProvider";
import "./theme/theme.css";

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
