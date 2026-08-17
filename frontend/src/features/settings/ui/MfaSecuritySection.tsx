// MFA "Security" settings section (HEL-702, design.md D6/D7): status view,
// enroll (via `MfaEnrollModal`), regenerate backup codes + disable -- both
// re-auth-gated with a current TOTP/backup code (design.md D6), shown as
// inline expandable prompts rather than a second modal (tasks.md 3.6).

import { type FormEvent, useEffect, useState } from "react";

import { InlineError } from "../../../shared/chrome/InlineError";
import { TextField } from "../../../shared/ui/index";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { pushToast } from "../../toasts/state/toastsSlice";
import {
  disableMfa,
  dismissMfaBackupCodes,
  dismissMfaEnrollment,
  fetchMfaStatus,
  regenerateMfaBackupCodes,
} from "../state/settingsSlice";
import { MfaBackupCodesList } from "./MfaBackupCodesList";
import { MfaEnrollModal } from "./MfaEnrollModal";
import "./MfaSecuritySection.css";

type Prompt = "regenerate" | "disable" | null;

export function MfaSecuritySection() {
  const dispatch = useAppDispatch();
  const mfa = useAppSelector((state) => state.settings.mfa);
  const [enrollModalOpen, setEnrollModalOpen] = useState(false);
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [reauthCode, setReauthCode] = useState("");

  useEffect(() => {
    void dispatch(fetchMfaStatus());
  }, [dispatch]);

  function closeEnroll() {
    setEnrollModalOpen(false);
    dispatch(dismissMfaEnrollment());
    dispatch(dismissMfaBackupCodes());
  }

  function openPrompt(next: Prompt) {
    // Clear any lingering regenerated-codes reveal from a prior flow the
    // user navigated away from without clicking "Done".
    dispatch(dismissMfaBackupCodes());
    setPrompt(next);
    setReauthCode("");
  }

  function closePrompt() {
    setPrompt(null);
    setReauthCode("");
  }

  async function handleRegenerate(e: FormEvent) {
    e.preventDefault();
    // Deliberately does not close the prompt on success -- the freshly
    // regenerated codes render in its place below until the user
    // acknowledges them via "Done" (design.md D6: shown exactly once).
    await dispatch(regenerateMfaBackupCodes(reauthCode));
  }

  async function handleDisable(e: FormEvent) {
    e.preventDefault();
    const result = await dispatch(disableMfa(reauthCode));
    if (disableMfa.fulfilled.match(result)) {
      closePrompt();
      dispatch(pushToast({ variant: "info", message: "Two-factor authentication disabled." }));
    }
  }

  async function handleCopyCodes(codes: string[]) {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      dispatch(pushToast({ variant: "success", message: "Backup codes copied to clipboard." }));
    } catch {
      dispatch(pushToast({ variant: "error", message: "Copy failed — select and copy manually." }));
    }
  }

  const isLoading = mfa.status === "idle" || mfa.status === "loading";
  const regeneratedCodes = prompt === "regenerate" ? mfa.backupCodes : null;

  return (
    <div className="mfa-security-section">
      {isLoading && (
        <p className="mfa-security-section__loading" aria-label="Loading two-factor status">
          Loading…
        </p>
      )}

      {!isLoading && mfa.error !== null && <InlineError error={mfa.error} />}

      {!isLoading && mfa.error === null && (
        <>
          <div className="mfa-security-section__status">
            <span
              className={`mfa-security-section__badge ${
                mfa.enabled ? "mfa-security-section__badge--on" : "mfa-security-section__badge--off"
              }`}
            >
              {mfa.enabled ? "Enabled" : "Disabled"}
            </span>
            {mfa.enabled && (
              <span className="mfa-security-section__detail">
                {mfa.verifiedAt !== null &&
                  `Confirmed ${new Date(mfa.verifiedAt).toLocaleString()} — `}
                {mfa.backupCodesRemaining} backup code{mfa.backupCodesRemaining === 1 ? "" : "s"}{" "}
                remaining
              </span>
            )}
          </div>

          {!mfa.enabled && (
            <button
              type="button"
              className="mfa-security-section__enable-btn"
              onClick={() => setEnrollModalOpen(true)}
            >
              Enable two-factor authentication
            </button>
          )}

          {mfa.enabled && (
            <div className="mfa-security-section__actions">
              {prompt !== "regenerate" && (
                <button
                  type="button"
                  className="mfa-security-section__action-btn"
                  onClick={() => openPrompt("regenerate")}
                >
                  Regenerate backup codes
                </button>
              )}
              {prompt !== "disable" && (
                <button
                  type="button"
                  className="mfa-security-section__action-btn mfa-security-section__action-btn--danger"
                  onClick={() => openPrompt("disable")}
                >
                  Disable
                </button>
              )}
            </div>
          )}

          {prompt === "regenerate" && regeneratedCodes === null && (
            <form
              className="mfa-security-section__prompt"
              onSubmit={(e) => void handleRegenerate(e)}
              noValidate
            >
              <p className="mfa-security-section__prompt-hint">
                Enter a current authenticator code or unused backup code to regenerate your backup
                codes.
              </p>
              <div className="mfa-security-section__prompt-row">
                <TextField
                  type="text"
                  mono
                  value={reauthCode}
                  onChange={(e) => setReauthCode(e.target.value)}
                  aria-label="Re-authentication code"
                  required
                  autoFocus
                />
                <button
                  type="submit"
                  className="mfa-security-section__confirm-btn"
                  disabled={mfa.regenerateStatus === "loading" || reauthCode.trim() === ""}
                >
                  {mfa.regenerateStatus === "loading" ? "Regenerating…" : "Regenerate"}
                </button>
                <button
                  type="button"
                  className="mfa-security-section__cancel-btn"
                  onClick={closePrompt}
                >
                  Cancel
                </button>
              </div>
              <InlineError error={mfa.regenerateError} />
            </form>
          )}

          {regeneratedCodes !== null && (
            <>
              <MfaBackupCodesList
                codes={regeneratedCodes}
                onCopyAll={() => void handleCopyCodes(regeneratedCodes)}
              />
              <button
                type="button"
                className="mfa-security-section__done-btn"
                onClick={() => {
                  dispatch(dismissMfaBackupCodes());
                  closePrompt();
                }}
              >
                Done
              </button>
            </>
          )}

          {prompt === "disable" && (
            <form
              className="mfa-security-section__prompt"
              onSubmit={(e) => void handleDisable(e)}
              noValidate
            >
              <p className="mfa-security-section__prompt-hint">
                Enter a current authenticator code or unused backup code to disable two-factor
                authentication.
              </p>
              <div className="mfa-security-section__prompt-row">
                <TextField
                  type="text"
                  mono
                  value={reauthCode}
                  onChange={(e) => setReauthCode(e.target.value)}
                  aria-label="Re-authentication code"
                  required
                  autoFocus
                />
                <button
                  type="submit"
                  className="mfa-security-section__confirm-btn mfa-security-section__confirm-btn--danger"
                  disabled={mfa.disableStatus === "loading" || reauthCode.trim() === ""}
                >
                  {mfa.disableStatus === "loading" ? "Disabling…" : "Disable"}
                </button>
                <button
                  type="button"
                  className="mfa-security-section__cancel-btn"
                  onClick={closePrompt}
                >
                  Cancel
                </button>
              </div>
              <InlineError error={mfa.disableError} />
            </form>
          )}
        </>
      )}

      <MfaEnrollModal open={enrollModalOpen} onClose={closeEnroll} />
    </div>
  );
}
