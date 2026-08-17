import { screen } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { render } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { authReducer, type AuthState } from "../state/authSlice";
import { ProtectedRoute } from "./ProtectedRoute";

/** F-081: surfaces the `from` location Navigate's `state` prop carried, so
 *  tests can assert on it without reaching into react-router internals. */
function LoginPageStub() {
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } } | null)?.from;
  return <div>Login page{from ? ` (from ${from.pathname})` : ""}</div>;
}

function renderWithAuth(authState: Partial<AuthState>, initialPath = "/") {
  const fullState: AuthState = {
    currentUser: null,
    status: "idle",
    submitStatus: "idle",
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
        <Route path="/pipelines/:id" element={<div>Protected content</div>} />
      </Route>
      <Route path="/login" element={<LoginPageStub />} />
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
    // F-081: ProtectedRoute always carries `state={{ from: location }}`, so
    // the stub's rendered text includes the current path (here "/") —
    // matched loosely rather than pinned to the no-`from` copy.
    expect(screen.getByText(/^Login page/)).toBeInTheDocument();
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

  // F-081: redirecting to /login without the deep link the visitor was on
  // meant a shared /pipelines/:id link (or a session expiring on a detail
  // page) always dropped them on the dashboards home after signing in.
  it("redirects to /login with the deep-linked path in location state", () => {
    renderWithAuth({ status: "unauthenticated" }, "/pipelines/abc-123");
    expect(screen.getByText("Login page (from /pipelines/abc-123)")).toBeInTheDocument();
  });
});
