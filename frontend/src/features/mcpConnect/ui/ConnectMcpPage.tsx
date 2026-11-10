// HEL-1709 -- consent page for an MCP connector (e.g. claude.ai) asking to act as the signed-in
// user. helio-mcp redirects here with `?request=<sealed pending request>`. Allow mints a named,
// 90-day PAT through the existing `POST /api/tokens` and hands it to helio-mcp by form POST; Deny
// mints nothing. One click grants an unscoped PAT to a redirect URI anyone can register, so the page
// refuses framing (also enforced by hosting headers), keeps Allow/Deny inert until the page has had
// the user's attention for 500 ms, and re-checks expiry before minting.

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { MCP_ORIGIN } from "../../../config/env";
import { useAppSelector } from "../../../hooks/reduxHooks";
import { OrbitMark } from "../../../shared/chrome/OrbitMark";
import { Spinner } from "../../../shared/ui/Spinner";
import { createApiToken } from "../../settings/services/apiTokenService";
import "../../auth/ui/auth.css";
import "./connectMcp.css";
import {
  type PendingInfo,
  connectorTokenName,
  fetchPendingInfo,
  isFramed,
  postDecision,
} from "../services/mcpConnectService";
import { useAttentionReady } from "./useAttentionReady";

const ATTENTION_HOLD_MS = 500;
const TOKEN_LIFETIME_DAYS = 90;
const FALLBACK_CLIENT_NAME = "An MCP client";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; info: PendingInfo }
  | { kind: "error"; message: string };

export function ConnectMcpPage() {
  const [searchParams] = useSearchParams();
  const request = searchParams.get("request") ?? "";
  const user = useAppSelector((state) => state.auth.currentUser);
  const attentive = useAttentionReady(ATTENTION_HOLD_MS);

  const framed = isFramed();
  const configured = MCP_ORIGIN !== "";
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [actionError, setActionError] = useState<string | null>(null);
  const [working, setWorking] = useState<"allow" | "deny" | null>(null);
  // A ref, not state: a second click in the same tick must see the first.
  const inFlight = useRef(false);

  useEffect(() => {
    if (framed || !configured) return;
    if (request === "") return;
    let cancelled = false;
    fetchPendingInfo(MCP_ORIGIN, request).then(
      (info) => {
        if (!cancelled) setLoad({ kind: "ready", info });
      },
      (err: unknown) => {
        if (!cancelled) setLoad({ kind: "error", message: (err as Error).message });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [framed, configured, request]);

  async function allow(info: PendingInfo) {
    if (inFlight.current) return;
    inFlight.current = true;
    setActionError(null);
    // Re-checked at the click: an expired request must mint nothing.
    if (Date.now() / 1000 >= info.expiresAt) {
      setLoad({ kind: "error", message: "This connection request has expired. Start again." });
      inFlight.current = false;
      return;
    }
    setWorking("allow");
    try {
      const created = await createApiToken({
        name: connectorTokenName(info.clientName, info.redirectHost),
        expiresInDays: TOKEN_LIFETIME_DAYS,
      });
      postDecision(MCP_ORIGIN, { request, pat: created.token });
    } catch {
      setActionError("Could not create the connector token. Please try again.");
      setWorking(null);
      inFlight.current = false;
    }
  }

  function deny() {
    if (inFlight.current) return;
    inFlight.current = true;
    setWorking("deny");
    postDecision(MCP_ORIGIN, { request, deny: "1" });
  }

  let body;
  if (framed) {
    body = <div className="auth-error">This page cannot be shown inside another page.</div>;
  } else if (!configured) {
    body = (
      <div className="auth-error">
        Connectors are unavailable: this app is not configured for them.
      </div>
    );
  } else if (request === "") {
    body = <div className="auth-error">This page needs a connection request to continue.</div>;
  } else if (load.kind === "loading") {
    body = (
      <div className="auth-loading auth-loading--inline" aria-label="Loading">
        <Spinner size="2xl" />
      </div>
    );
  } else if (load.kind === "error") {
    body = <div className="auth-error">{load.message}</div>;
  } else {
    const { info } = load;
    const clientName = info.clientName?.trim() || FALLBACK_CLIENT_NAME;
    const disabled = !attentive || working !== null;
    body = (
      <>
        <dl className="connect-mcp__facts">
          <dt className="eyebrow">Application</dt>
          <dd>{clientName}</dd>
          <dt className="eyebrow">Access is sent to</dt>
          <dd>{info.redirectHost}</dd>
          {user && (
            <>
              <dt className="eyebrow">Signed in as</dt>
              <dd>{user.displayName ?? user.email}</dd>
            </>
          )}
        </dl>
        <p className="connect-mcp__note">
          Allowing creates a 90-day access token in your account that this application can use to
          read and change your workspace. You can revoke it any time in Settings.
        </p>
        <button
          type="button"
          className="auth-submit"
          disabled={disabled}
          onClick={() => void allow(info)}
        >
          {working === "allow" ? "Connecting…" : "Allow"}
        </button>
        <button type="button" className="auth-secondary-btn" disabled={disabled} onClick={deny}>
          Deny
        </button>
        {actionError && <div className="auth-error">{actionError}</div>}
      </>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-card__brand">
          <OrbitMark size={18} />
          <span className="auth-card__brand-name">Helio</span>
        </div>
        <h1 className="auth-card__title">Connect an application</h1>
        <p className="auth-card__subtitle">An application is asking to use your Helio workspace</p>
        {body}
      </div>
    </div>
  );
}
