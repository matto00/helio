import { type FormEvent, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { Location } from "react-router-dom";

import { TextField } from "../../../shared/ui/index";
import { API_BASE_URL } from "../../../config/env";
import { OrbitMark } from "../../../shared/chrome/OrbitMark";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { register } from "../state/authSlice";
import { rememberReturnTo } from "../utils/postLoginReturnTo";
import "./auth.css";

interface AuthLocationState {
  from?: Location;
}

/** Reduces a react-router `Location` back to a navigable path string. */
function pathFromLocation(location: Location): string {
  return `${location.pathname}${location.search}${location.hash}`;
}

// F-234: the backend's raw error strings are lowercase, unpunctuated fragments (e.g. "email
// already registered") — fine as a machine-readable code, not fine rendered verbatim as
// user-facing copy. `"email already registered"` gets its own clearer rewrite; anything else is
// capitalized and given terminal punctuation rather than shown exactly as the server wrote it.
function formatAuthError(message: string): string {
  if (message === "email already registered") return "This email is already registered.";
  const capitalized = message.charAt(0).toUpperCase() + message.slice(1);
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

export function RegisterPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const submitStatus = useAppSelector((state) => state.auth.submitStatus);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // F-081: mirrors LoginPage — a visitor bounced from a protected deep link
  // who lands here instead (e.g. via the "Create one" link) still gets sent
  // back to it once they've signed up.
  const from = (location.state as AuthLocationState | null)?.from;

  const isLoading = submitStatus === "loading";

  function validatePassword(value: string): boolean {
    if (value.length < 8) {
      setPasswordError("Password must be at least 8 characters.");
      return false;
    }
    setPasswordError(null);
    return true;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!validatePassword(password)) {
      return;
    }

    const result = await dispatch(
      register({
        email,
        password,
        displayName: displayName.trim() || undefined,
      }),
    );

    if (register.fulfilled.match(result)) {
      void navigate(from ? pathFromLocation(from) : "/");
    } else {
      const payload = result.payload as string | undefined;
      setError(payload ? formatAuthError(payload) : "Registration failed.");
    }
  }

  function handleGoogleSignUp() {
    // See LoginPage's handleGoogleSignIn — same sessionStorage relay across
    // the full-page OAuth round trip (F-081).
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
        <h1 className="auth-card__title">Create account</h1>
        <p className="auth-card__subtitle">Get started with Helio</p>

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
              autoComplete="new-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (passwordError) validatePassword(e.target.value);
              }}
              required
            />
            {passwordError && <span className="auth-field__error">{passwordError}</span>}
          </div>

          <div className="auth-field">
            <label htmlFor="displayName">Display name (optional)</label>
            <TextField
              id="displayName"
              type="text"
              autoComplete="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>

          <button type="submit" className="auth-submit" disabled={isLoading}>
            {isLoading ? "Creating account…" : "Create account"}
          </button>

          {error && <div className="auth-error">{error}</div>}
        </form>

        <div className="auth-divider">or</div>

        <button type="button" className="auth-google-btn" onClick={handleGoogleSignUp}>
          <span>G</span>
          Continue with Google
        </button>

        <p className="auth-footer">
          Already have an account?{" "}
          <Link to="/login" state={from ? { from } : undefined}>
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
