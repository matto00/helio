/**
 * helio-mcp as an OAuth 2.1 authorization server for MCP connectors (HEL-1709, design D3).
 *
 * Nothing is stored here: client ids, pending requests, codes, access tokens and refresh tokens are
 * sealed values (see `seal.ts`). The access token is the signed-in user's Helio PAT, sealed; the
 * consent page mints that PAT and hands it back through `/oauth/callback`. The one thing that cannot
 * be stateless is refresh-token reuse detection (two instances share no memory), so each refresh
 * family's current token id lives, as a hash, in the Helio backend (HEL-1713, `familyClient.ts`).
 */

import type { Response } from "express";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import {
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidTargetError,
  InvalidTokenError,
  ServerError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { randomBytes } from "node:crypto";
import type { HttpConfig } from "../httpConfig.js";
import { FamilyClient } from "./familyClient.js";
import {
  ACCESS_TTL_SECONDS,
  CODE_TTL_SECONDS,
  PENDING_TTL_SECONDS,
  REFRESH_TTL_SECONDS,
  SealError,
  open,
  seal,
} from "./seal.js";
import { displayText, redirectUriAllowed, sha256Hex } from "./util.js";

export const MAX_CLIENT_PROJECTION_BYTES = 2048;
export const MAX_STATE_CHARS = 1024;
export const MAX_CLIENT_NAME_CHARS = 40;

interface ClientSeal extends Record<string, unknown> {
  redirect_uris: string[];
  client_name?: string;
  grant_types?: string[];
  response_types?: string[];
}

export interface PendingSeal extends Record<string, unknown> {
  clientIdHash: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
  exp: number;
}

export interface CodeSeal extends Record<string, unknown> {
  pat: string;
  clientIdHash: string;
  redirectUri: string;
  codeChallenge: string;
}

interface AccessSeal extends Record<string, unknown> {
  pat: string;
  clientIdHash: string;
  exp: number;
}

interface RefreshSeal extends Record<string, unknown> {
  pat: string;
  clientIdHash: string;
  resource: string;
  familyId: string;
  jti: string;
}

export interface ProviderOptions {
  readonly familyTimeoutMs?: number;
  /** One-line logger; receives status codes and error names only, never token material. */
  readonly log?: (line: string) => void;
}

const REVOKED_MESSAGE = "authorization was revoked; authorize again";
const newJti = (): string => randomBytes(32).toString("base64url");

/** Fragment dropped and one trailing slash ignored, as the SDK's bearer check compares. */
function comparableResource(value: URL | string): string {
  const text = String(value);
  const hash = text.indexOf("#");
  return (hash === -1 ? text : text.slice(0, hash)).replace(/\/$/, "");
}

export class HelioOAuthProvider implements OAuthServerProvider {
  /** Codes redeemed by this instance, so an in-instance replay is refused (value = expiry ms). */
  private readonly usedCodes = new Map<string, number>();

  private readonly family: FamilyClient;
  private readonly log: (line: string) => void;

  constructor(
    private readonly config: HttpConfig,
    private readonly now: () => number = Date.now,
    options: ProviderOptions = {},
  ) {
    this.family = new FamilyClient(config.apiBaseUrl, options.familyTimeoutMs);
    this.log = options.log ?? (() => undefined);
  }

  get clientsStore(): OAuthRegisteredClientsStore {
    return {
      registerClient: (info) => this.registerClient(info),
      getClient: (id) => this.getClient(id),
    };
  }

  private registerClient(
    info: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">,
  ): OAuthClientInformationFull {
    for (const uri of info.redirect_uris) {
      if (!redirectUriAllowed(String(uri), this.config.allowedRedirectHosts)) {
        throw new InvalidClientMetadataError(
          "redirect_uris must be https (or loopback http) URLs on an allowed host",
        );
      }
    }
    const projection: ClientSeal = {
      redirect_uris: info.redirect_uris.map(String),
      grant_types: info.grant_types,
      response_types: info.response_types,
    };
    const name = displayText(info.client_name, MAX_CLIENT_NAME_CHARS);
    if (name) projection.client_name = name;
    if (Buffer.byteLength(JSON.stringify(projection), "utf8") > MAX_CLIENT_PROJECTION_BYTES) {
      throw new InvalidClientMetadataError("client metadata is too large");
    }
    const clientId = seal(this.config.keys, "client", projection, 0, this.now());
    // Every client is public: whatever was requested or omitted, no secret exists.
    const result: OAuthClientInformationFull = {
      ...info,
      client_id: clientId,
      client_id_issued_at: Math.floor(this.now() / 1000),
      token_endpoint_auth_method: "none",
    };
    delete result.client_secret;
    delete result.client_secret_expires_at;
    return result;
  }

  private getClient(clientId: string): OAuthClientInformationFull | undefined {
    try {
      const body = open<ClientSeal>(this.config.keys, "client", clientId, this.now());
      return {
        client_id: clientId,
        redirect_uris: body.redirect_uris,
        client_name: body.client_name,
        grant_types: body.grant_types,
        response_types: body.response_types,
        token_endpoint_auth_method: "none",
      };
    } catch (err) {
      if (err instanceof SealError) return undefined;
      throw err;
    }
  }

  /** Throws `invalid_target` unless `resource` (when given) is this server's canonical resource. */
  private checkResource(resource: URL | undefined): void {
    if (resource === undefined) return;
    if (comparableResource(resource) !== comparableResource(this.config.resourceUrl)) {
      throw new InvalidTargetError("resource does not identify this server");
    }
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    // Re-applied here: a client sealed under a wider list is refused once the list is narrowed.
    // Answered directly (never redirected): the redirect target is exactly what is untrusted.
    if (!redirectUriAllowed(params.redirectUri, this.config.allowedRedirectHosts)) {
      res.status(400).json({
        error: "invalid_request",
        error_description: "redirect_uri is not permitted by this server",
      });
      return;
    }
    if ((params.state?.length ?? 0) > MAX_STATE_CHARS) {
      res.status(400).json({
        error: "invalid_request",
        error_description: `state is longer than ${MAX_STATE_CHARS} characters`,
      });
      return;
    }
    this.checkResource(params.resource);
    const pending: Record<string, unknown> = {
      clientIdHash: sha256Hex(client.client_id),
      clientName: client.client_name ?? "",
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
    };
    if (params.state !== undefined) pending.state = params.state;
    const request = seal(this.config.keys, "pending", pending, PENDING_TTL_SECONDS, this.now());
    const target = new URL("/connect/mcp", this.config.appUrl);
    target.searchParams.set("request", request);
    res.redirect(302, target.href);
  }

  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    return this.openCode(client, authorizationCode).codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    const code = this.openCode(client, authorizationCode);
    if (redirectUri !== undefined && redirectUri !== code.redirectUri) {
      throw new InvalidGrantError("redirect_uri does not match the authorization request");
    }
    this.checkResource(resource);
    this.markUsed(authorizationCode);
    const tokens = this.accessTokens(code.pat, code.clientIdHash);
    if (!client.grant_types?.includes("refresh_token")) return tokens;

    const jti = newJti();
    const outcome = await this.family.create(code.pat, {
      clientIdHash: code.clientIdHash,
      resource: comparableResource(this.config.resourceUrl),
      jtiHash: sha256Hex(jti),
    });
    if (outcome.kind === "revoked") throw new InvalidGrantError(REVOKED_MESSAGE);
    if (outcome.kind === "unavailable") {
      this.log(
        `helio-mcp: refresh family not created (${outcome.detail}); issuing no refresh token`,
      );
      return tokens;
    }
    return {
      ...tokens,
      refresh_token: this.sealRefresh(
        code,
        outcome.family.familyId,
        jti,
        outcome.family.expiresAtMs,
      ),
    };
  }

  /**
   * Redeem a refresh token (design D5): checks that need no backend run first, then one atomic
   * rotation on the backend decides whether this token is still the family's current one. Reuse
   * makes the backend delete the PAT, so the whole family and every access token sealing it die.
   */
  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    _scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    let body: RefreshSeal;
    try {
      body = open<RefreshSeal>(this.config.keys, "refresh", refreshToken, this.now());
    } catch {
      throw new InvalidGrantError("refresh token is invalid or expired");
    }
    if (body.clientIdHash !== sha256Hex(client.client_id)) {
      throw new InvalidGrantError("refresh token was issued to another client");
    }
    this.checkResource(resource);
    const canonical = comparableResource(this.config.resourceUrl);
    if (body.resource !== canonical) {
      throw new InvalidGrantError("refresh token was issued for another resource");
    }

    const jti = newJti();
    const outcome = await this.family.rotate(body.pat, {
      familyId: body.familyId,
      clientIdHash: body.clientIdHash,
      resource: canonical,
      presentedJtiHash: sha256Hex(body.jti),
      nextJtiHash: sha256Hex(jti),
    });
    switch (outcome.kind) {
      case "rotated":
        return {
          ...this.accessTokens(body.pat, body.clientIdHash),
          refresh_token: this.sealRefresh(body, body.familyId, jti, outcome.expiresAtMs),
        };
      case "revoked":
        throw new InvalidGrantError(REVOKED_MESSAGE);
      case "refused":
        throw new InvalidGrantError(
          outcome.reason === "reused"
            ? "refresh token was already used; authorization was revoked, authorize again"
            : outcome.reason === "expired"
              ? "refresh token has expired; authorize again"
              : "refresh token does not match this client or resource",
        );
      case "unavailable":
        this.log(`helio-mcp: refresh rotation failed (${outcome.detail})`);
        throw new ServerError("the refresh could not be completed; retry shortly");
    }
  }

  private accessTokens(pat: string, clientIdHash: string): OAuthTokens {
    const access = seal(
      this.config.keys,
      "access",
      { pat, clientIdHash },
      ACCESS_TTL_SECONDS,
      this.now(),
    );
    return { access_token: access, token_type: "bearer", expires_in: ACCESS_TTL_SECONDS };
  }

  /** Sealed `exp` = min(now + 30 days, the family's expiry, which is the PAT's own). */
  private sealRefresh(
    from: { pat: string; clientIdHash: string },
    familyId: string,
    jti: string,
    familyExpiresAtMs: number,
  ): string {
    const nowSeconds = Math.floor(this.now() / 1000);
    const ttl = Math.min(REFRESH_TTL_SECONDS, Math.floor(familyExpiresAtMs / 1000) - nowSeconds);
    return seal(
      this.config.keys,
      "refresh",
      {
        pat: from.pat,
        clientIdHash: from.clientIdHash,
        resource: comparableResource(this.config.resourceUrl),
        familyId,
        jti,
      } satisfies Omit<RefreshSeal, "kind">,
      ttl,
      this.now(),
    );
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    let body: AccessSeal;
    try {
      body = open<AccessSeal>(this.config.keys, "access", token, this.now());
    } catch {
      throw new InvalidTokenError("Invalid or expired access token");
    }
    return {
      token,
      clientId: body.clientIdHash,
      scopes: [],
      expiresAt: body.exp,
      resource: this.config.resourceUrl,
      extra: { pat: body.pat },
    };
  }

  private openCode(client: OAuthClientInformationFull, code: string): CodeSeal {
    let body: CodeSeal;
    try {
      body = open<CodeSeal>(this.config.keys, "code", code, this.now());
    } catch {
      throw new InvalidGrantError("authorization code is invalid or expired");
    }
    if (body.clientIdHash !== sha256Hex(client.client_id)) {
      throw new InvalidGrantError("authorization code was issued to another client");
    }
    if (this.isUsed(code)) throw new InvalidGrantError("authorization code was already used");
    return body;
  }

  private isUsed(code: string): boolean {
    const now = this.now();
    for (const [key, expiry] of this.usedCodes) if (expiry <= now) this.usedCodes.delete(key);
    return this.usedCodes.has(sha256Hex(code));
  }

  private markUsed(code: string): void {
    this.usedCodes.set(sha256Hex(code), this.now() + (CODE_TTL_SECONDS + 5) * 1000);
  }

  /** Open a pending request (consent page + callback); returns `undefined` when invalid/expired. */
  openPending(request: string): PendingSeal | undefined {
    try {
      return open<PendingSeal>(this.config.keys, "pending", request, this.now());
    } catch {
      return undefined;
    }
  }

  /** Seal the authorization code for a pending request and a PAT the backend accepted. */
  issueCode(pending: PendingSeal, pat: string): string {
    return seal(
      this.config.keys,
      "code",
      {
        pat,
        clientIdHash: pending.clientIdHash,
        redirectUri: pending.redirectUri,
        codeChallenge: pending.codeChallenge,
      } satisfies Omit<CodeSeal, "kind">,
      CODE_TTL_SECONDS,
      this.now(),
    );
  }
}
