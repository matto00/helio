import { type FormEvent, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import type { Location } from "react-router-dom";

import { TextField } from "../../../shared/ui/index";
import { API_BASE_URL } from "../../../config/env";
import { OrbitMark } from "../../../shared/chrome/OrbitMark";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { isMfaRequiredResponse, login } from "../state/authSlice";
import { rememberReturnTo } from "../utils/postLoginReturnTo";
import "./auth.css";

interface AuthLocationState {
  from?: Location;
}

/** Reduces a react-router `Location` back to a navigable path string. */
function pathFromLocation(location: Location): string {
  return `${location.pathname}${location.search}${location.hash}`;
}

export function LoginPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const submitStatus = useAppSelector((state) => state.auth.submitStatus);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  // F-081: ProtectedRoute redirects here with `state={{ from: location }}`
  // so a login triggered by a deep link (or an expired session on a detail
  // page) lands the visitor back where they were, not on the dashboards home.
  const from = (location.state as AuthLocationState | null)?.from;

  const isLoading = submitStatus === "loading";
  const oauthError =
    searchParams.get("error") === "oauth_failed"
      ? "Google sign-in failed. Please try again."
      : null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const result = await dispatch(login({ email, password }));
    if (login.fulfilled.match(result)) {
      // HEL-702: MFA-enabled accounts get a pending challenge instead of a
      // session — route to the verification step rather than the app.
      void navigate(
        isMfaRequiredResponse(result.payload)
          ? "/login/verify"
          : from
            ? pathFromLocation(from)
            : "/",
      );
    } else {
      setError((result.payload as string | undefined) ?? "Login failed.");
    }
  }

  function handleGoogleSignIn() {
    // The OAuth round trip is a full-page navigation away from the SPA, so
    // `from` (in-memory router state) can't survive it — stash it in
    // sessionStorage for OAuthCallbackPage to pick back up (F-081).
    rememberReturnTo(from ? pathFromLocation(from) : null);
    window.location.href = `${API_BASE_URL}/api/auth/google`;
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-card__brand">
          <OrbitMark size={18} />
          <span className="auth-card__brand-name">Helio</span>
        </div>
        <h1 className="auth-card__title">Welcome back</h1>
        <p className="auth-card__subtitle">Sign in to your workspace</p>

        <form onSubmit={(e) => void handleSubmit(e)} noValidate>
          <div className="auth-field">
            <label htmlFor="email">Email</label>
            <TextField
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="auth-field">
            <label htmlFor="password">Password</label>
            <TextField
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button type="submit" className="auth-submit" disabled={isLoading}>
            {isLoading ? "Signing in…" : "Sign in"}
          </button>

          {error && <div className="auth-error">{error}</div>}
        </form>

        {oauthError && <div className="auth-error">{oauthError}</div>}

        <div className="auth-divider">or</div>

        <button type="button" className="auth-google-btn" onClick={handleGoogleSignIn}>
          <span>G</span>
          Continue with Google
        </button>

        <p className="auth-footer">
          Don&rsquo;t have an account?{" "}
          <Link to="/register" state={from ? { from } : undefined}>
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}
