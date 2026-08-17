// MFA enrollment modal (HEL-702, design.md D6/D7): QR + manual key -> confirm
// code -> one-time backup codes, all three steps in one modal (tasks.md 3.6).
// Self-starts enrollment when opened; closing at any step (X/backdrop/ESC,
// all routed through `onClose`) just resets local UI state -- the backend
// has no "cancel" concept, and a fresh `startMfaEnrollment` upsert simply
// replaces any unconfirmed secret (design.md D6).

import { type FormEvent, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { faCopy } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

import { InlineError } from "../../../shared/chrome/InlineError";
import { Modal, TextField } from "../../../shared/ui/index";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { pushToast } from "../../toasts/state/toastsSlice";
import { confirmMfaEnrollment, startMfaEnrollment } from "../state/settingsSlice";
import { MfaBackupCodesList } from "./MfaBackupCodesList";
import "./MfaEnrollModal.css";

interface MfaEnrollModalProps {
  open: boolean;
  onClose: () => void;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function MfaEnrollModal({ open, onClose }: MfaEnrollModalProps) {
  const dispatch = useAppDispatch();
  const { enrollStatus, enrollError, enrollment, confirmStatus, confirmError, backupCodes } =
    useAppSelector((state) => state.settings.mfa);
  const [code, setCode] = useState("");
  const startedRef = useRef(false);

  useEffect(() => {
    if (open && !startedRef.current) {
      startedRef.current = true;
      void dispatch(startMfaEnrollment());
    }
    if (!open) {
      startedRef.current = false;
    }
  }, [open, dispatch]);

  async function handleCopy(text: string, label: string) {
    const copied = await copyToClipboard(text);
    dispatch(
      pushToast(
        copied
          ? { variant: "success", message: `${label} copied to clipboard.` }
          : { variant: "error", message: "Copy failed — select and copy manually." },
      ),
    );
  }

  async function handleConfirm(e: FormEvent) {
    e.preventDefault();
    await dispatch(confirmMfaEnrollment(code));
  }

  function handleClose() {
    setCode("");
    onClose();
  }

  const step: "loading" | "scan" | "codes" | "error" =
    backupCodes !== null
      ? "codes"
      : enrollment !== null
        ? "scan"
        : enrollStatus === "failed"
          ? "error"
          : "loading";

  return (
    <Modal open={open} onClose={handleClose} title="Set up two-factor authentication" size="md">
      {step === "loading" && <p className="mfa-enroll-modal__hint">Generating your secret…</p>}

      {step === "error" && (
        <>
          <InlineError error={enrollError} />
          <button
            type="button"
            className="mfa-enroll-modal__retry-btn"
            onClick={() => void dispatch(startMfaEnrollment())}
          >
            Try again
          </button>
        </>
      )}

      {step === "scan" && enrollment !== null && (
        <div className="mfa-enroll-modal__scan">
          <p className="mfa-enroll-modal__hint">
            Scan this QR code with your authenticator app, or enter the key manually.
          </p>
          {/* HEL-702: QR modules are intentionally hardcoded black-on-white,
           * not theme tokens -- a scannable QR code needs fixed high
           * contrast regardless of light/dark theme (data requirement, same
           * documented exception class as AccentPicker's preset swatches
           * per DESIGN.md §3). */}
          <div className="mfa-enroll-modal__qr">
            <QRCodeSVG
              value={enrollment.otpauthUri}
              size={180}
              bgColor="#ffffff"
              fgColor="#000000"
            />
          </div>
          <div className="mfa-enroll-modal__key-row">
            <TextField mono readOnly value={enrollment.secret} aria-label="Manual entry key" />
            <button
              type="button"
              className="mfa-enroll-modal__copy-btn"
              aria-label="Copy manual entry key"
              onClick={() => void handleCopy(enrollment.secret, "Key")}
            >
              <FontAwesomeIcon icon={faCopy} aria-hidden="true" />
            </button>
          </div>

          <form
            className="mfa-enroll-modal__confirm-form"
            onSubmit={(e) => void handleConfirm(e)}
            noValidate
          >
            <div className="mfa-enroll-modal__field">
              <label htmlFor="mfa-confirm-code">Enter the 6-digit code from your app</label>
              <TextField
                id="mfa-confirm-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                mono
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                autoFocus
              />
            </div>
            <InlineError error={confirmError} />
            <button
              type="submit"
              className="mfa-enroll-modal__confirm-btn"
              disabled={confirmStatus === "loading" || code.trim() === ""}
            >
              {confirmStatus === "loading" ? "Confirming…" : "Confirm and enable"}
            </button>
          </form>
        </div>
      )}

      {step === "codes" && backupCodes !== null && (
        <div className="mfa-enroll-modal__codes">
          <MfaBackupCodesList
            codes={backupCodes}
            onCopyAll={() => void handleCopy(backupCodes.join("\n"), "Backup codes")}
          />
          <button type="button" className="mfa-enroll-modal__done-btn" onClick={handleClose}>
            Done
          </button>
        </div>
      )}
    </Modal>
  );
}
