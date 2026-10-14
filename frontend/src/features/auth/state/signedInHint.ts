import type { AppStartListening } from "../../../store/listenerMiddleware";

/**
 * A boolean hint that this browser has signed in, read by the static landing page's inline head
 * script (`frontend/index.html`) to send returning users straight to `/home`. It carries no
 * credential, token or user identifier; the session itself is an HttpOnly cookie. A stale hint
 * costs one bounce through `/home` to `/login`.
 */
export const SIGNED_IN_HINT_KEY = "helio.signedIn";

function writeHint(signedIn: boolean): void {
  try {
    if (signedIn) {
      window.localStorage.setItem(SIGNED_IN_HINT_KEY, "1");
    } else {
      window.localStorage.removeItem(SIGNED_IN_HINT_KEY);
    }
  } catch {
    // localStorage unavailable (private mode / quota): the landing page just renders normally.
  }
}

/**
 * The one choke point for the hint: every sign-in path (login, register, OAuth callback, MFA
 * verification, session rehydration) and every sign-out path (logout, a 401, a failed session
 * check) ends in a change of `auth.status`. `idle` and `loading` are neither, so they are ignored.
 */
export function registerSignedInHintListener(startListening: AppStartListening) {
  startListening({
    predicate: (_action, currentState, previousState) =>
      currentState.auth.status !== previousState.auth.status &&
      (currentState.auth.status === "authenticated" ||
        currentState.auth.status === "unauthenticated"),
    effect: (_action, listenerApi) => {
      writeHint(listenerApi.getState().auth.status === "authenticated");
    },
  });
}
