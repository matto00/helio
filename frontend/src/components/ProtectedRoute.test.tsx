import { screen } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { render } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { authReducer, type AuthState } from "../features/auth/authSlice";
import { ProtectedRoute } from "./ProtectedRoute";

function renderWithAuth(authState: Partial<AuthState>, initialPath = "/") {
  const fullState: AuthState = {
    currentUser: null,
    token: null,
    status: "idle",
    ...authState,
  };

  const store = configureStore({
    reducer: { auth: authReducer },
    preloadedState: { auth: fullState },
  });

  function Wrapper({ children }: PropsWithChildren) {
    return (
      <MemoryRouter initialEntries={[initialPath]}>
        <Provider store={store}>{children}</Provider>
      </MemoryRouter>
    );
  }

  render(
    <Routes>
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<div>Protected content</div>} />
      </Route>
      <Route path="/login" element={<div>Login page</div>} />
    </Routes>,
    { wrapper: Wrapper },
  );

  return { store };
}

describe("ProtectedRoute", () => {
  it("renders children (Outlet) when status is authenticated", () => {
    renderWithAuth({ status: "authenticated" });
    expect(screen.getByText("Protected content")).toBeInTheDocument();
    expect(screen.queryByText("Login page")).not.toBeInTheDocument();
  });

  it("redirects to /login when status is unauthenticated", () => {
    renderWithAuth({ status: "unauthenticated" });
    expect(screen.getByText("Login page")).toBeInTheDocument();
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
  });

  it("shows a loading indicator when status is idle", () => {
    renderWithAuth({ status: "idle" });
    expect(screen.getByLabelText("Loading")).toBeInTheDocument();
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
    expect(screen.queryByText("Login page")).not.toBeInTheDocument();
  });

  it("shows a loading indicator when status is loading", () => {
    renderWithAuth({ status: "loading" });
    expect(screen.getByLabelText("Loading")).toBeInTheDocument();
  });
});
