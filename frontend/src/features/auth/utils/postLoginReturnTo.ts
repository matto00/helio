/** F-081: preserves the deep link a visitor was on when `ProtectedRoute`
 *  bounced them to `/login`, across the one auth path that can't carry
 *  React Router's in-memory `location.state` — the Google OAuth redirect.
 *
 *  `window.location.href = "/api/auth/google"` is a full browser navigation
 *  away from the SPA (through Google, back to the backend, back to
 *  `/auth/callback`), so any JS-held state is lost. `sessionStorage`
 *  survives that round trip; `rememberReturnTo` stashes the path right
 *  before the redirect and `consumeReturnTo` reads + clears it once
 *  `OAuthCallbackPage` knows the exchange succeeded. Same-tab submit flows
 *  (plain email/password login/register) never need this — they stay
 *  in-SPA, so `location.state.from` alone is enough there. */

const RETURN_TO_STORAGE_KEY = "helio.auth.returnTo";

/** Stash `path` for `consumeReturnTo` to pick up after an OAuth round trip.
 *  Skips storage entirely for `/home` (or nothing) since that's the default
 *  destination anyway. Silently no-ops if `sessionStorage` is unavailable
 *  (private browsing / quota) — the OAuth flow still completes, it just
 *  lands on `/home` instead of the deep link. */
export function rememberReturnTo(path: string | null | undefined): void {
  try {
    if (path && path !== "/home") {
      window.sessionStorage.setItem(RETURN_TO_STORAGE_KEY, path);
    } else {
      window.sessionStorage.removeItem(RETURN_TO_STORAGE_KEY);
    }
  } catch {
    // sessionStorage unavailable — fall through, OAuth still works.
  }
}

/** Reads and clears the path stashed by `rememberReturnTo`, if any. */
export function consumeReturnTo(): string | null {
  try {
    const value = window.sessionStorage.getItem(RETURN_TO_STORAGE_KEY);
    if (value) {
      window.sessionStorage.removeItem(RETURN_TO_STORAGE_KEY);
    }
    return value;
  } catch {
    return null;
  }
}

/** HEL-1709: only a same-origin relative path (`/x?y#z`) is ever followed after sign-in. Rejects
 *  absolute URLs, protocol-relative `//host`, and backslash tricks (`/\\host`). */
export function safeReturnPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(value)) return null;
  return value;
}

/** The post-sign-in destination carried in router `state.from`: either a path string (the
 *  Google round trip) or a react-router `Location` (a `ProtectedRoute` bounce). */
export function returnPathFromState(state: unknown): string | null {
  const from = (state as { from?: unknown } | null | undefined)?.from;
  if (typeof from === "string") return safeReturnPath(from);
  if (typeof from === "object" && from !== null) {
    const loc = from as { pathname?: unknown; search?: unknown; hash?: unknown };
    if (typeof loc.pathname !== "string") return null;
    return safeReturnPath(
      `${loc.pathname}${typeof loc.search === "string" ? loc.search : ""}${
        typeof loc.hash === "string" ? loc.hash : ""
      }`,
    );
  }
  return null;
}
