// MfaSecuritySection tests (HEL-702, tasks.md 4.7): enroll flow renders the
// QR + manual key, confirm enables MFA and shows the one-time backup codes,
// and the disable re-auth prompt.

import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";

import * as authService from "../../auth/services/authService";
import { toastsReducer } from "../../toasts/state/toastsSlice";
import { settingsReducer } from "../state/settingsSlice";
import { MfaSecuritySection } from "./MfaSecuritySection";

jest.mock("../../auth/services/authService", () => ({
  mfaStatusRequest: jest.fn(),
  mfaEnrollRequest: jest.fn(),
  mfaConfirmRequest: jest.fn(),
  mfaRegenerateRequest: jest.fn(),
  mfaDisableRequest: jest.fn(),
}));

const mockedAuthService = jest.mocked(authService);

function renderSection() {
  const store = configureStore({
    reducer: { settings: settingsReducer, toasts: toastsReducer },
  });
  const { container, ...rest } = render(
    <Provider store={store}>
      <MfaSecuritySection />
    </Provider>,
  );
  return { store, container, ...rest };
}

describe("MfaSecuritySection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // jsdom does not implement showModal/close natively (MfaEnrollModal uses
    // the shared `Modal`, built on a native <dialog>); stub them, mirroring
    // shared/ui/Modal.test.tsx.
    HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    });
  });

  it("shows a disabled status and an Enable button by default", async () => {
    mockedAuthService.mfaStatusRequest.mockResolvedValue({
      enabled: false,
      verifiedAt: null,
      backupCodesRemaining: 0,
    });
    renderSection();

    await waitFor(() => {
      expect(screen.getByText("Disabled")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "Enable two-factor authentication" }),
    ).toBeInTheDocument();
  });

  it("enroll flow: renders the QR + manual key, confirms, and shows one-time backup codes", async () => {
    mockedAuthService.mfaStatusRequest.mockResolvedValue({
      enabled: false,
      verifiedAt: null,
      backupCodesRemaining: 0,
    });
    mockedAuthService.mfaEnrollRequest.mockResolvedValue({
      secret: "JBSWY3DPEHPK3PXP",
      otpauthUri: "otpauth://totp/Helio:test@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Helio",
    });
    mockedAuthService.mfaConfirmRequest.mockResolvedValue({
      backupCodes: ["AAAAAAAAAA", "BBBBBBBBBB"],
    });
    const { container } = renderSection();

    await waitFor(() => {
      expect(screen.getByText("Disabled")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Enable two-factor authentication" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Manual entry key")).toHaveValue("JBSWY3DPEHPK3PXP");
    });
    // Renders the actual scannable QR code, not just the manual-entry key.
    expect(container.querySelector(".mfa-enroll-modal__qr svg")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Enter the 6-digit code from your app"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm and enable" }));

    await waitFor(() => {
      expect(screen.getByText("AAAAAAAAAA")).toBeInTheDocument();
    });
    expect(screen.getByText("BBBBBBBBBB")).toBeInTheDocument();
    expect(mockedAuthService.mfaConfirmRequest).toHaveBeenCalledWith("123456");

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => {
      expect(screen.getByText("Enabled")).toBeInTheDocument();
    });
  });

  it("shows the disable re-auth prompt and calls mfaDisableRequest with the entered code", async () => {
    mockedAuthService.mfaStatusRequest.mockResolvedValue({
      enabled: true,
      verifiedAt: "2026-08-01T00:00:00Z",
      backupCodesRemaining: 10,
    });
    mockedAuthService.mfaDisableRequest.mockResolvedValue(undefined);
    renderSection();

    await waitFor(() => {
      expect(screen.getByText("Enabled")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Disable" }));

    fireEvent.change(screen.getByLabelText("Re-authentication code"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Disable" }));

    await waitFor(() => {
      expect(mockedAuthService.mfaDisableRequest).toHaveBeenCalledWith("123456");
    });
    await waitFor(() => {
      expect(screen.getByText("Disabled")).toBeInTheDocument();
    });
  });
});
