import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAppDispatch, useAppSelector } from "../../hooks/reduxHooks";
import { register } from "./authSlice";
import "./auth.css";

export function RegisterPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const status = useAppSelector((state) => state.auth.status);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isLoading = status === "loading";

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
      void navigate("/");
    } else {
      setError((result.payload as string | undefined) ?? "Registration failed.");
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-card__title">Create account</h1>
        <p className="auth-card__subtitle">Get started with Helio</p>

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
            <input
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

        <p className="auth-footer">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
