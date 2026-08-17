// MFA login-time verification step (HEL-702, design.md D7): `/login/verify`.
// `login`/`handleOAuthCallback` land here (instead of `/`) when the account
// has MFA enabled, having stashed the pending challenge in `authSlice`
// (`mfaChallenge`). Visiting with no challenge in state (e.g. a stale
// bookmark, a page refresh — the challenge is transient/never persisted)
// redirects to `/login` rather than rendering a dead end.

import { type FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";

import { OrbitMark } from "../../../shared/chrome/OrbitMark";
import { TextField } from "../../../shared/ui/index";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { verifyMfa } from "../state/authSlice";
import "./auth.css";

export function MfaVerifyPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const status = useAppSelector((state) => state.auth.status);
  const mfaChallenge = useAppSelector((state) => state.auth.mfaChallenge);

  const [code, setCode] = useState("");
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isLoading = status === "loading";

  if (mfaChallenge === null) {
    return <Navigate to="/login" replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const result = await dispatch(verifyMfa({ code }));
    if (verifyMfa.fulfilled.match(result)) {
      void navigate("/");
    } else {
      setError((result.payload as string | undefined) ?? "Invalid code. Please try again.");
    }
  }

  function toggleBackupCode() {
    setUseBackupCode((prev) => !prev);
    setCode("");
    setError(null);
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-card__brand">
          <OrbitMark size={18} />
          <span className="auth-card__brand-name">Helio</span>
        </div>
        <h1 className="auth-card__title">Two-factor verification</h1>
        <p className="auth-card__subtitle">
          {useBackupCode
            ? "Enter one of your unused backup codes"
            : "Enter the 6-digit code from your authenticator app"}
        </p>

        <form onSubmit={(e) => void handleSubmit(e)} noValidate>
          <div className="auth-field">
            <label htmlFor="mfa-code">
              {useBackupCode ? "Backup code" : "Authentication code"}
            </label>
            <TextField
              id="mfa-code"
              type="text"
              inputMode={useBackupCode ? "text" : "numeric"}
              autoComplete="one-time-code"
              mono
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              autoFocus
            />
          </div>

          <button type="submit" className="auth-submit" disabled={isLoading || code.trim() === ""}>
            {isLoading ? "Verifying…" : "Verify"}
          </button>

          {error && <div className="auth-error">{error}</div>}
        </form>

        <button type="button" className="auth-link-btn" onClick={toggleBackupCode}>
          {useBackupCode ? "Use an authenticator code instead" : "Use a backup code instead"}
        </button>
      </div>
    </div>
  );
}
