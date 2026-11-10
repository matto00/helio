/**
 * The consent hand-off between helio-mcp and the Helio web app (HEL-1709, design D4):
 *
 * - `GET  /oauth/pending?request=` -> what the consent page shows (client name, redirect host).
 *   CORS-restricted to `HELIO_APP_URL`, no credentials.
 * - `POST /oauth/callback` -> the browser form POST carrying the pending request plus the freshly
 *   minted PAT (or a denial). On success it 302s to the client's redirect URI with a sealed code.
 *
 * The PAT travels only in the POST body; it is never placed in a URL or logged.
 */

import cors from "cors";
import express, { type Router } from "express";
import { rateLimit } from "express-rate-limit";
import type { HttpConfig } from "../httpConfig.js";
import { checkPat } from "./patCheck.js";
import type { HelioOAuthProvider } from "./provider.js";
import { connectorTokenName, displayText, sendErrorPage } from "./util.js";

const PAT_PREFIX = "helio_pat_";
const MAX_FORM_BYTES = "16kb";
const MAX_REQUEST_CHARS = 8192;
const MAX_PAT_CHARS = 512;

function redirectWith(redirectUri: string, params: Record<string, string | undefined>): string {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
  return url.href;
}

export function createConsentRouter(config: HttpConfig, provider: HelioOAuthProvider): Router {
  const router = express.Router();
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "too_many_requests", error_description: "Too many requests" },
  });

  router.get(
    "/oauth/pending",
    limiter,
    cors({ origin: config.appUrl.origin, methods: ["GET"], credentials: false }),
    (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      const request = typeof req.query.request === "string" ? req.query.request : "";
      const pending =
        request.length > 0 && request.length <= MAX_REQUEST_CHARS
          ? provider.openPending(request)
          : undefined;
      if (!pending) {
        res
          .status(400)
          .json({ error: "invalid_request", error_description: "Invalid or expired request" });
        return;
      }
      const clientName = displayText(pending.clientName, 40);
      res.json({
        ...(clientName ? { clientName } : {}),
        redirectHost: new URL(pending.redirectUri).host,
        expiresAt: pending.exp,
      });
    },
  );

  router.post(
    "/oauth/callback",
    limiter,
    express.urlencoded({ extended: false, limit: MAX_FORM_BYTES, parameterLimit: 10 }),
    async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const request = typeof body.request === "string" ? body.request : "";
      const pat = typeof body.pat === "string" ? body.pat.trim() : "";
      const deny = body.deny === "1";
      const pending =
        request.length > 0 && request.length <= MAX_REQUEST_CHARS
          ? provider.openPending(request)
          : undefined;
      if (!pending) {
        sendErrorPage(
          res,
          400,
          "Authorization request expired",
          "This connection request is invalid or has expired. Start again from the application you were connecting.",
        );
        return;
      }
      if (deny) {
        res.redirect(
          302,
          redirectWith(pending.redirectUri, { error: "access_denied", state: pending.state }),
        );
        return;
      }
      const tokenName = connectorTokenName(pending.clientName, new URL(pending.redirectUri).host);
      const revokeHint = `A token named "${tokenName}" may have been created in your Helio account. Revoke it under Settings, then API tokens.`;
      if (!pat.startsWith(PAT_PREFIX) || pat.length > MAX_PAT_CHARS) {
        sendErrorPage(
          res,
          400,
          "Could not authorize",
          "The credential supplied was not valid.",
          revokeHint,
        );
        return;
      }
      const status = await checkPat(config.apiBaseUrl, pat);
      if (status !== "live") {
        const message =
          status === "unknown"
            ? "Helio could not be reached to confirm the credential. Try again shortly."
            : "Helio did not accept the credential for a connector.";
        sendErrorPage(
          res,
          status === "unknown" ? 502 : 400,
          "Could not authorize",
          message,
          revokeHint,
        );
        return;
      }
      res.redirect(
        302,
        redirectWith(pending.redirectUri, {
          code: provider.issueCode(pending, pat),
          state: pending.state,
        }),
      );
    },
  );

  return router;
}
