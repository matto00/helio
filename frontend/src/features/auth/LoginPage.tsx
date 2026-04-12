import { type FormEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { useAppDispatch, useAppSelector } from "../../hooks/reduxHooks";
import { login } from "./authSlice";
import "./auth.css";

export function LoginPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const status = useAppSelector((state) => state.auth.status);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isLoading = status === "loading";
  const oauthError =
    searchParams.get("error") === "oauth_failed"
      ? "Google sign-in failed. Please try again."
      : null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const result = await dispatch(login({ email, password }));
    if (login.fulfilled.match(result)) {
      void navigate("/");
    } else {
      setError((result.payload as string | undefined) ?? "Login failed.");
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-card__title">Sign in</h1>
        <p className="auth-card__subtitle">Welcome back to Helio</p>

        <form onSubmit={(e) => void handleSubmit(e)} noValidate>
          <div className="auth-field">
            <label htmlFor="email">Email</label>
            <input
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
            <input
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

        <button
          type="button"
          className="auth-google-btn"
          onClick={() => {
            window.location.href = "/api/auth/google";
          }}
        >
          <span>G</span>
          Continue with Google
        </button>

        <p className="auth-footer">
          Don&rsquo;t have an account? <Link to="/register">Create one</Link>
        </p>
      </div>
    </div>
  );
}
