// HEL-955 design.md D8: the out-of-band completion page -- reached at
// `/connectors/complete?token=...`, OUTSIDE `ProtectedRoute` (AppRoutes.tsx's public-dashboard
// precedent), so an unauthenticated human handed this link never gets redirected to /login.
// Submission goes through `connectorCompletionService.ts` -- an UNAUTHENTICATED call, never the
// authenticated `connectorEntityService` thunks. The credential lives in local `useState` for
// the submit's lifetime only. Mirrors LoginPage.tsx's markup/class conventions (`auth-page`/
// `auth-card`/`auth-field`/`auth-submit`) since this is the same "unauthenticated standalone
// form" shape.
//
// Evaluation-1.md CR4: this page used to collect an "Authentication type" selection and then
// discard it -- the credential field's label changed to match the human's own selection, but
// the submission never carried it and the bound credential's actual shape was whatever the
// pending row already persisted (design.md D9). That is user-visible misinformation in a
// security flow. Fixed per D9's own stated resolution: the page now fetches the pending
// Connector's INTENDED auth shape (`GET /api/connectors/completion?token=...`) and renders the
// credential field from IT, not from a form the human fills in and this page then ignores.

import { type FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { TextField } from "../../../shared/ui/index";
import { OrbitMark } from "../../../shared/chrome/OrbitMark";
import {
  completeConnector,
  getPendingConnectorAuthShape,
} from "../services/connectorCompletionService";
import "../../auth/ui/auth.css";

type ShapeStatus = { kind: "loading" } | { kind: "loaded"; authType: string } | { kind: "error" };

export function ConnectorCompletionPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [shape, setShape] = useState<ShapeStatus>({ kind: "loading" });
  const [credential, setCredential] = useState("");
  const [submitStatus, setSubmitStatus] = useState<"idle" | "loading" | "success" | "error">(
    "idle",
  );

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getPendingConnectorAuthShape(token)
      .then((result) => {
        if (!cancelled) setShape({ kind: "loaded", authType: result.authType });
      })
      .catch(() => {
        if (!cancelled) setShape({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitStatus("loading");
    try {
      await completeConnector({ token, credential });
      setSubmitStatus("success");
    } catch {
      // design.md D5: every failure mode (unknown/expired/consumed/superseded token, wrong
      // owner, encryption failure) surfaces as the SAME generic message -- never distinguished.
      setSubmitStatus("error");
    }
  }

  const credentialLabel =
    shape.kind === "loaded" && shape.authType === "api_key"
      ? "API key value"
      : "Bearer token value";

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-card__brand">
          <OrbitMark size={18} />
          <span className="auth-card__brand-name">Helio</span>
        </div>
        <h1 className="auth-card__title">Complete Connector setup</h1>

        {!token ? (
          <p className="auth-card__subtitle">This link is missing its completion token.</p>
        ) : submitStatus === "success" ? (
          <p className="auth-card__subtitle">
            Credential submitted. The Connector is now ready to use — you can close this page.
          </p>
        ) : shape.kind === "loading" ? (
          <p className="auth-card__subtitle">Loading…</p>
        ) : shape.kind === "error" ? (
          <p role="alert" className="auth-error">
            This completion link is invalid or has expired. Ask for a new one.
          </p>
        ) : (
          <>
            <p className="auth-card__subtitle">
              A credential is needed to finish setting up this Connector.
            </p>
            <form onSubmit={(e) => void handleSubmit(e)} noValidate>
              <div className="auth-field">
                <label className="eyebrow" htmlFor="completion-credential">
                  {credentialLabel}
                </label>
                <TextField
                  id="completion-credential"
                  type="password"
                  mono
                  autoComplete="off"
                  value={credential}
                  onChange={(e) => setCredential(e.target.value)}
                  required
                />
              </div>
              {submitStatus === "error" && (
                <p role="alert" className="auth-error">
                  This completion link is invalid or has expired. Ask for a new one.
                </p>
              )}
              <button
                type="submit"
                className="auth-submit"
                disabled={submitStatus === "loading" || credential.trim().length === 0}
              >
                {submitStatus === "loading" ? "Submitting…" : "Submit credential"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
