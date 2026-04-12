import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { useAppDispatch } from "../../hooks/reduxHooks";
import { handleOAuthCallback } from "./authSlice";
import "./auth.css";

export function OAuthCallbackPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const calledRef = useRef(false);

  useEffect(() => {
    // Guard against React StrictMode double-invoke — OAuth codes are single-use.
    if (calledRef.current) return;
    calledRef.current = true;

    const error = searchParams.get("error");
    const code = searchParams.get("code");
    const state = searchParams.get("state") ?? undefined;

    if (error !== null) {
      void navigate("/login?error=oauth_failed", { replace: true });
      return;
    }

    if (code !== null) {
      void dispatch(handleOAuthCallback({ code, state })).then((result) => {
        if (handleOAuthCallback.fulfilled.match(result)) {
          void navigate("/", { replace: true });
        } else {
          void navigate("/login?error=oauth_failed", { replace: true });
        }
      });
      return;
    }

    // No code or error — unexpected state, redirect to login.
    void navigate("/login", { replace: true });
  }, [dispatch, navigate, searchParams]);

  return (
    <div className="auth-page">
      <div className="auth-card">
        <p className="auth-card__subtitle">Signing in…</p>
      </div>
    </div>
  );
}
