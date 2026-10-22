// Kept drafts are keyed by pipeline id only, so they must not outlive the session. `clearAuth` is the one action every
// sign-out path dispatches (logout, the 401 interceptor, a failed `rehydrateAuth`), which is why this listens to it
// rather than the logout thunk alone. Note `rehydrateAuth` swallows every error, so a network failure at page load
// also drops kept drafts: the app already treats that case as signed out.

import type { AppStartListening } from "../../../store/listenerMiddleware";
import { clearAuth } from "../../auth/state/authSlice";
import { clearKeptDrafts } from "./keptDraft";

export function registerKeptDraftClearListener(startListening: AppStartListening) {
  startListening({
    actionCreator: clearAuth,
    effect: () => {
      clearKeptDrafts();
    },
  });
}
