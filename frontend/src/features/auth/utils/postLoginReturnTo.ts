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
 *  Skips storage entirely for `/` (or nothing) since that's the default
 *  destination anyway. Silently no-ops if `sessionStorage` is unavailable
 *  (private browsing / quota) — the OAuth flow still completes, it just
 *  lands on `/` instead of the deep link. */
export function rememberReturnTo(path: string | null | undefined): void {
  try {
    if (path && path !== "/") {
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
