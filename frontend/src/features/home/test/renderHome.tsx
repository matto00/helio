import { configureStore } from "@reduxjs/toolkit";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { authReducer } from "../../auth/state/authSlice";
import { dashboardsReducer } from "../../dashboards/state/dashboardsSlice";
import type { Dashboard } from "../../dashboards/types/dashboard";
import { onboardingReducer } from "../../onboarding/state/onboardingSlice";
import { homeSummaryReducer } from "../state/homeSummarySlice";

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{`${location.pathname}|${JSON.stringify(location.state)}`}</p>;
}

export function renderHome(
  ui: ReactElement,
  options: {
    dashboards?: Dashboard[];
    dashboardsStatus?: "idle" | "loading" | "succeeded" | "failed";
  } = {},
) {
  const dashboards = dashboardsReducer(undefined, { type: "init" });
  const reducer = {
    auth: authReducer,
    dashboards: dashboardsReducer,
    homeSummary: homeSummaryReducer,
    onboarding: onboardingReducer,
  };
  const store = configureStore({
    reducer,
    preloadedState: {
      dashboards: {
        ...dashboards,
        items: options.dashboards ?? [],
        status: options.dashboardsStatus ?? "succeeded",
      },
    },
  });
  const utils = render(
    <MemoryRouter initialEntries={["/home"]}>
      <Provider store={store}>
        <Routes>
          <Route path="*" element={ui} />
        </Routes>
        <LocationProbe />
      </Provider>
    </MemoryRouter>,
  );
  return { store, ...utils };
}
