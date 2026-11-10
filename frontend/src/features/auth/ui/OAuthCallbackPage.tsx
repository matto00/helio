import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { OrbitMark } from "../../../shared/chrome/OrbitMark";
import { Spinner } from "../../../shared/ui/Spinner";
import { useAppDispatch } from "../../../hooks/reduxHooks";
import { handleOAuthCallback, isMfaRequiredResponse } from "../state/authSlice";
import { consumeReturnTo, safeReturnPath } from "../utils/postLoginReturnTo";
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
      consumeReturnTo();
      void navigate("/login?error=oauth_failed", { replace: true });
      return;
    }

    if (code !== null) {
      void dispatch(handleOAuthCallback({ code, state })).then((result) => {
        if (handleOAuthCallback.fulfilled.match(result)) {
          // HEL-702: same MFA branch as LoginPage — route to the
          // verification step instead of the app when a challenge was issued.
          if (isMfaRequiredResponse(result.payload)) {
            // HEL-1709: the Google round trip's stashed deep link rides to the verify step.
            const returnTo = consumeReturnTo();
            void navigate("/login/verify", {
              replace: true,
              state: returnTo ? { from: returnTo } : undefined,
            });
            return;
          }
          // F-081: restore the deep link stashed by Login/RegisterPage
          // before the redirect to Google, if there was one.
          void navigate(safeReturnPath(consumeReturnTo()) ?? "/home", { replace: true });
        } else {
          consumeReturnTo();
          void navigate("/login?error=oauth_failed", { replace: true });
        }
      });
      return;
    }

    // No code or error — unexpected state, redirect to login.
    consumeReturnTo();
    void navigate("/login", { replace: true });
  }, [dispatch, navigate, searchParams]);

  return (
    <div className="auth-page">
      <div className="auth-card">
        {/* F-192: same brand row + title as LoginPage/RegisterPage so this
            transitional screen doesn't break the shared auth-card scaffold. */}
        <div className="auth-card__brand">
          <OrbitMark size={18} />
          <span className="auth-card__brand-name">Helio</span>
        </div>
        <h1 className="auth-card__title">Signing in…</h1>
        <p className="auth-card__subtitle">Completing your Google sign-in</p>
        <div className="auth-loading auth-loading--inline" aria-label="Loading">
          <Spinner size="2xl" />
        </div>
      </div>
    </div>
  );
}
