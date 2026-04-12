import { configureStore } from "@reduxjs/toolkit";
import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { authReducer } from "./authSlice";
import { LoginPage } from "./LoginPage";

jest.mock("../../services/authService", () => ({
  loginRequest: jest.fn(),
  registerRequest: jest.fn(),
  logoutRequest: jest.fn(),
  getMeRequest: jest.fn(),
  oauthCallbackRequest: jest.fn(),
}));

jest.mock("../../services/httpClient", () => ({
  httpClient: { defaults: { headers: { common: {} } } },
  setAuthToken: jest.fn(),
}));

function makeStore() {
  return configureStore({ reducer: { auth: authReducer } });
}

function renderLoginPage(search = "") {
  const store = makeStore();
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[`/login${search}`]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
  return { store };
}

describe("LoginPage", () => {
  it("renders the oauth error message when ?error=oauth_failed is in the URL", () => {
    renderLoginPage("?error=oauth_failed");

    expect(screen.getByText("Google sign-in failed. Please try again.")).toBeInTheDocument();
  });

  it("does not render the oauth error message when no error param is present", () => {
    renderLoginPage();

    expect(screen.queryByText("Google sign-in failed. Please try again.")).not.toBeInTheDocument();
  });

  it("does not render the oauth error message for unrelated error values", () => {
    renderLoginPage("?error=some_other_error");

    expect(screen.queryByText("Google sign-in failed. Please try again.")).not.toBeInTheDocument();
  });

  it("renders the Continue with Google button as enabled", () => {
    renderLoginPage();

    const googleBtn = screen.getByRole("button", { name: /Continue with Google/i });
    expect(googleBtn).not.toBeDisabled();
  });
});
